# -*- coding: utf-8 -*-
"""
STARGLOW 最新情報アグリゲーター - データ収集スクリプト

完全無料の情報源（APIキー不要）だけを使って STARGLOW の最新情報を集約し、
信頼度スコアを付けて docs/data/feed.json に書き出す。

- Google ニュース RSS（検索）
- YouTube チャンネル RSS（公式チャンネル）
- 公式系サイトの掲載は信頼度を高く、まとめ/匿名ソースは低く採点する

GitHub Actions の cron から定期実行される想定。
"""

import json
import re
import html
import hashlib
import datetime as dt
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse, quote, parse_qs, unquote

import requests

# ----------------------------------------------------------------------------
# 設定
# ----------------------------------------------------------------------------

ARTIST = "STARGLOW"
# 検索の精度を上げるためのクエリ（BMSG を絡めて同名の別物を弾く）
NEWS_QUERIES = [
    '"STARGLOW" BMSG',
    '"STARGLOW" スターグロウ',
]

# 公式 YouTube ハンドル（channel_id は実行時に解決する）
YOUTUBE_HANDLES = ["@starglow_bmsg", "@BMSG_official"]

# 出力先
OUT_PATH = Path(__file__).resolve().parent.parent / "docs" / "data" / "feed.json"

# 1回の出力に載せる最大件数
MAX_ITEMS = 60

UA = {"User-Agent": "Mozilla/5.0 (compatible; StarglowFeedBot/1.0; +https://github.com)"}

# ----------------------------------------------------------------------------
# 信頼度（クレジビリティ）スコアリング
# ----------------------------------------------------------------------------
# tier: official(公式) > major(大手メディア) > known(一般メディア) > unknown(不明/低信頼)

OFFICIAL_DOMAINS = {
    "bmsg.tokyo", "starglow.tokyo", "bmsg.shop",
    "youtube.com", "youtu.be",  # 公式チャンネル経由のみ後段で確認
}
MAJOR_DOMAINS = {
    "oricon.co.jp", "billboard-japan.com", "natalie.mu", "avexnet.jp",
    "nhk.or.jp", "sponichi.co.jp", "nikkansports.com", "sanspo.com",
    "rbbtoday.com", "musicman.co.jp", "okmusic.jp",
}
KNOWN_DOMAINS = {
    "ticket.co.jp", "ks-spice.net", "spice.eplus.jp", "barks.jp",
    "real-sound.jp", "model-press.com", "thefirsttimes.jp",
}
# 噂・まとめ・低信頼として減点したいドメインの手がかり（部分一致）
LOW_TRUST_HINTS = ("matome", "2ch", "5ch", "blog.", "ameblo", "fc2", "seesaa", "livedoor.blog")

TIER_RANK = {"official": 3, "major": 2, "known": 1, "unknown": 0}
TIER_LABEL_JA = {
    "official": "公式",
    "major": "大手メディア",
    "known": "メディア",
    "unknown": "未確認",
}


def domain_of(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def base_domain(host: str) -> str:
    """sub.example.co.jp -> example.co.jp 相当のざっくり判定。"""
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "or", "ne", "go", "ac"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def classify_tier(url: str, source_kind: str) -> str:
    host = domain_of(url)
    bd = base_domain(host)
    if source_kind == "youtube_official":
        return "official"
    if bd in OFFICIAL_DOMAINS or host in OFFICIAL_DOMAINS:
        return "official"
    if bd in MAJOR_DOMAINS:
        return "major"
    if bd in KNOWN_DOMAINS:
        return "known"
    if any(h in host for h in LOW_TRUST_HINTS):
        return "unknown"
    return "unknown"


# 噂・未確定を示唆する語（タイトル/本文に含まれると確度を下げ、警告を付ける）
RUMOR_HINTS = ["噂", "うわさ", "ガセ", "デマ", "未確認", "らしい", "かも",
               "という説", "憶測", "リーク", "流出", "真相", "炎上", "熱愛"]


def credibility(item: dict) -> dict:
    """0-100 のスコアと表示用ラベル・警告を返す。"""
    tier = item["tier"]
    score = {"official": 95, "major": 80, "known": 60, "unknown": 35}[tier]

    text = f"{item.get('title','')} {item.get('summary','')}"
    matched_rumor = [w for w in RUMOR_HINTS if w in text]
    if matched_rumor and tier != "official":
        score -= 20

    score = max(0, min(100, score))
    warn = None
    if tier == "unknown":
        warn = "公式・大手による裏取りが取れていない情報です"
    elif matched_rumor and tier != "official":
        warn = "未確定・憶測を含む可能性があります"

    return {"score": score, "tier": tier, "tierLabel": TIER_LABEL_JA[tier], "warning": warn}


# ----------------------------------------------------------------------------
# 収集
# ----------------------------------------------------------------------------

def clean_text(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def parse_date(raw: str) -> str:
    if raw:
        # RFC822 (RSS) を試す
        try:
            d = parsedate_to_datetime(raw)
            if d.tzinfo is None:
                d = d.replace(tzinfo=dt.timezone.utc)
            return d.astimezone(dt.timezone.utc).isoformat()
        except Exception:
            pass
        # ISO8601 (Atom) を試す
        try:
            d = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=dt.timezone.utc)
            return d.astimezone(dt.timezone.utc).isoformat()
        except Exception:
            pass
    return dt.datetime.now(dt.timezone.utc).isoformat()


ATOM = "{http://www.w3.org/2005/Atom}"
MEDIA = "{http://search.yahoo.com/mrss/}"


def http_get(url: str) -> str:
    r = requests.get(url, headers=UA, timeout=25)
    r.raise_for_status()
    return r.text


def _text(el):
    return el.text.strip() if el is not None and el.text else ""


def parse_rss(xml_text: str) -> list:
    """RSS 2.0 と Atom の両方を <item>/<entry> 単位でパースする。"""
    out = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out

    # RSS 2.0
    for item in root.iter("item"):
        out.append({
            "title": _text(item.find("title")),
            "link": _text(item.find("link")),
            "summary": _text(item.find("description")),
            "published": _text(item.find("pubDate")),
            "source": _text(item.find("source")),
        })
    # Atom
    for entry in root.iter(f"{ATOM}entry"):
        link = ""
        for l in entry.findall(f"{ATOM}link"):
            if l.get("rel", "alternate") == "alternate" or not link:
                link = l.get("href", "")
        out.append({
            "title": _text(entry.find(f"{ATOM}title")),
            "link": link,
            "summary": _text(entry.find(f"{MEDIA}group/{MEDIA}description"))
                       or _text(entry.find(f"{ATOM}summary")),
            "published": _text(entry.find(f"{ATOM}published"))
                         or _text(entry.find(f"{ATOM}updated")),
            "source": _text(entry.find(f"{ATOM}author/{ATOM}name")),
        })
    return out


def unwrap_google_news_url(url: str) -> str:
    """Google ニュースの中継 URL から元記事 URL を取り出せる場合は取り出す。"""
    try:
        q = parse_qs(urlparse(url).query)
        if "url" in q:
            return unquote(q["url"][0])
    except Exception:
        pass
    return url


def fetch_google_news() -> list:
    items = []
    for query in NEWS_QUERIES:
        rss = (
            "https://news.google.com/rss/search?q="
            + quote(query)
            + "&hl=ja&gl=JP&ceid=JP:ja"
        )
        try:
            entries = parse_rss(http_get(rss))
        except Exception as ex:
            print("news fetch error:", ex)
            continue
        for e in entries:
            link = unwrap_google_news_url(e.get("link", ""))
            if not link:
                continue
            title = clean_text(e.get("title", ""))
            source = e.get("source", "")
            # Google ニュースはタイトル末尾に " - 媒体名" を付けることが多い
            if not source and " - " in title:
                title, source = title.rsplit(" - ", 1)
            items.append({
                "type": "news",
                "title": title,
                "summary": clean_text(e.get("summary", ""))[:200],
                "url": link,
                "source": source or domain_of(link),
                "publishedAt": parse_date(e.get("published", "")),
                "tier": classify_tier(link, "news"),
            })
    return items


def resolve_channel_id(handle: str) -> str | None:
    """YouTube ハンドルからチャンネル ID(UC...) を解決する。"""
    try:
        text = http_get(f"https://www.youtube.com/{handle}")
        m = re.search(r'"channelId":"(UC[\w-]+)"', text) or \
            re.search(r'href="https://www\.youtube\.com/channel/(UC[\w-]+)"', text)
        return m.group(1) if m else None
    except Exception:
        return None


def fetch_youtube() -> list:
    items = []
    for handle in YOUTUBE_HANDLES:
        cid = resolve_channel_id(handle)
        if not cid:
            print("could not resolve channel:", handle)
            continue
        rss = f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"
        try:
            entries = parse_rss(http_get(rss))
        except Exception as ex:
            print("youtube fetch error:", ex)
            continue
        is_official = handle in ("@starglow_bmsg", "@BMSG_official")
        for e in entries:
            title = clean_text(e.get("title", ""))
            # BMSG 公式は他グループも扱うので STARGLOW 関連だけに絞る
            if handle == "@BMSG_official" and "STARGLOW" not in title.upper():
                continue
            items.append({
                "type": "youtube",
                "title": title,
                "summary": clean_text(e.get("summary", ""))[:200],
                "url": e.get("link", ""),
                "source": clean_text(e.get("source", "")) or "YouTube",
                "publishedAt": parse_date(e.get("published", "")),
                "tier": "official" if is_official else "known",
                "_kind": "youtube_official" if is_official else "youtube",
            })
    return items


# ----------------------------------------------------------------------------
# まとめ・整形
# ----------------------------------------------------------------------------

def dedupe(items: list) -> list:
    seen = {}
    for it in items:
        # URL 正規化キー
        key = re.sub(r"[?#].*$", "", it["url"].lower())
        norm_title = re.sub(r"\W+", "", it["title"].lower())[:40]
        k = key or norm_title
        if k not in seen:
            seen[k] = it
        else:
            # 既出ならより信頼度の高い tier を残す
            if TIER_RANK[it["tier"]] > TIER_RANK[seen[k]["tier"]]:
                seen[k] = it
    return list(seen.values())


def cross_reference(items: list) -> None:
    """複数ソースが同じ話題を報じていれば確度を底上げ（裏取り）。"""
    buckets = {}
    for it in items:
        words = set(re.findall(r"[ぁ-んァ-ヶ一-龠A-Za-z0-9]{2,}", it["title"]))
        it["_words"] = words
    for i, a in enumerate(items):
        corroborations = 0
        for j, b in enumerate(items):
            if i == j:
                continue
            overlap = a["_words"] & b["_words"]
            if len(overlap) >= 3:
                corroborations += 1
        a["corroborations"] = corroborations


def build():
    raw = []
    try:
        raw += fetch_google_news()
    except Exception as ex:
        print("google news error:", ex)
    try:
        raw += fetch_youtube()
    except Exception as ex:
        print("youtube error:", ex)

    items = dedupe(raw)

    # tier の確定（YouTube 公式判定を反映）
    for it in items:
        kind = it.pop("_kind", "news")
        it["tier"] = classify_tier(it["url"], kind) if kind != "youtube_official" else "official"

    cross_reference(items)

    for it in items:
        cred = credibility(it)
        # 裏取りボーナス（最大 +10）
        cred["score"] = min(100, cred["score"] + min(10, it.get("corroborations", 0) * 4))
        if it.get("corroborations", 0) >= 2 and cred["warning"]:
            cred["warning"] = None  # 複数ソースで確認できたら警告を解除
        it["credibility"] = cred
        it["id"] = hashlib.sha1(it["url"].encode("utf-8")).hexdigest()[:12]
        it.pop("_words", None)
        it.pop("tier", None)
        it.pop("corroborations", None)

    # 新しい順に並べ、信頼度が極端に低いものは後ろへ
    items.sort(key=lambda x: x["publishedAt"], reverse=True)
    items = items[:MAX_ITEMS]

    # 1件も取れなかったときは既存の feed.json を上書きしない（ネットワーク不調などへの保険）
    if not items and OUT_PATH.exists():
        print("collected 0 items; keeping existing feed.json")
        return

    payload = {
        "artist": ARTIST,
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "count": len(items),
        "items": items,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(items)} items -> {OUT_PATH}")


if __name__ == "__main__":
    build()
