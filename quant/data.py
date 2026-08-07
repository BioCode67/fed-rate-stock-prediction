# -*- coding: utf-8 -*-
"""
data.py — 데이터 모으기

세 가지 경로를 지원합니다.
  1) synthetic : 인터넷 없이 만드는 가상 시장(종목 여러 개). 파이프라인 점검·수업용.
  2) yfinance  : 실제 주가. 종목 목록을 받아 한 번에 내려받고 캐시에 저장합니다.
  3) csv       : 직접 모아 둔 종목별 CSV 폴더.

매크로(금리·스프레드·VIX)는 FRED의 공개 CSV 주소에서 받습니다. API 키가 필요 없습니다.

모든 데이터는 Panel 하나로 정리합니다.
  dates  (T,)     거래일
  close  (T, N)   종목별 종가 (없는 날은 NaN)
  volume (T, N)   거래량
  macro  (T, M)   매크로 지표
  bench  (T,)     벤치마크 지수 (선택)
"""

from __future__ import annotations

import io
import json
import os
import urllib.request
from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np

from .config import Config, MACRO_SERIES


@dataclass
class Panel:
    dates: np.ndarray             # datetime64[D], (T,)
    tickers: List[str]
    close: np.ndarray             # (T, N)
    volume: np.ndarray            # (T, N)
    macro: np.ndarray             # (T, M)
    macro_names: List[str]
    bench: Optional[np.ndarray]   # (T,)
    meta: Dict

    @property
    def T(self) -> int:
        return len(self.dates)

    @property
    def N(self) -> int:
        return len(self.tickers)

    def describe(self) -> str:
        valid = np.isfinite(self.close)
        per_day = valid.sum(axis=1)
        return (
            f"[데이터] {self.meta.get('name', '')}\n"
            f"  기간   : {self.dates[0]} ~ {self.dates[-1]}  ({self.T:,}거래일)\n"
            f"  종목   : {self.N}개 (하루 평균 {per_day.mean():.0f}개 유효)\n"
            f"  매크로 : {', '.join(self.macro_names) if self.macro_names else '없음'}\n"
            f"  출처   : {self.meta.get('source')}"
            + ("   ※ 가상 데이터입니다. 실제 시장이 아닙니다." if self.meta.get("synthetic") else "")
        )


# ===========================================================================
#  1) 가상 시장 만들기
# ---------------------------------------------------------------------------
#  진짜 시장의 뼈대만 흉내 냅니다.
#    수익률 = 베타 × 시장 + 섹터 + 개별 잡음 + (선택) 숨은 신호
#  숨은 신호는 '20일 모멘텀이 높고, 변동성이 낮고, 금리 상승에 덜 민감한 종목이
#  다음 며칠 조금 더 오른다'는 아주 약한 규칙입니다. signal=0이면 규칙이 사라져
#  이론상 어떤 모델도 IC가 0 근처여야 합니다. 도구 점검에 쓰기 좋습니다.
# ===========================================================================
def make_synthetic(cfg: Config) -> Panel:
    rng = np.random.default_rng(cfg.seed)
    T, N = cfg.syn_n_days, cfg.syn_n_stocks
    n_sector = 6

    dates = np.busday_offset(np.datetime64("2010-01-04"), np.arange(T), roll="forward").astype("datetime64[D]")

    sector = rng.integers(0, n_sector, size=N)
    beta = np.clip(rng.normal(1.0, 0.3, size=N), 0.3, 2.0)
    idio_vol = np.clip(rng.normal(0.016, 0.005, size=N), 0.006, 0.05)
    rate_beta = rng.normal(0.0, 1.0, size=N)          # 금리 상승에 대한 민감도

    # 금리: 시기별 목표를 향해 천천히 움직입니다.
    targets = np.interp(np.arange(T), [0, 0.42 * T, 0.62 * T, 0.74 * T, 0.90 * T, T],
                        [0.5, 0.5, 2.4, 0.2, 4.8, 3.6])
    rate = np.zeros(T)
    r = 0.6
    for t in range(T):
        r += (targets[t] - r) * 0.004 + rng.normal(0, 0.012)
        rate[t] = max(0.02, r)
    d_rate20 = np.concatenate([np.zeros(20), rate[20:] - rate[:-20]])

    close = np.zeros((T, N))
    volume = np.zeros((T, N))
    px = 100.0 * np.exp(rng.normal(0, 0.5, size=N))
    mkt_vol, prev_shock = 0.010, 0.0
    sec_state = np.zeros(n_sector)
    ret_hist = np.zeros((T, N))

    for t in range(T):
        # 시장 요인 (변동성 뭉침)
        mkt_vol = np.sqrt(2.0e-6 + 0.08 * prev_shock ** 2 + 0.90 * mkt_vol ** 2)
        shock = rng.normal(0, mkt_vol)
        prev_shock = shock
        mkt = 0.0004 + shock - 0.0006 * (rate[t] - rate[t - 1] if t else 0.0)

        # 섹터 요인
        #  ★ 일부러 '그날 하루짜리'로 만듭니다(지속성 없음).
        #    처음에는 0.85로 이어지게 만들었는데, 그러면 syn_signal=0으로 두어도
        #    섹터 모멘텀이라는 예측 가능한 구조가 남아 IC가 0.22까지 나왔습니다.
        #    '신호 0 = 정말로 예측 불가능'이어야 도구 점검에 쓸 수 있으므로 지속성을 뺐습니다.
        #    (지속성을 넣어 보고 싶으면 syn_sector_persist 를 올리면 됩니다)
        sec_state = cfg.syn_sector_persist * sec_state + rng.normal(0, 0.004, size=n_sector)

        # 숨은 신호: '어제까지의 정보'로만 만듭니다(누수 방지).
        hidden = np.zeros(N)
        if cfg.syn_signal > 0 and t > 60:
            mom = close[t - 1] / close[t - 21] - 1.0
            vol20 = ret_hist[t - 20:t].std(axis=0) + 1e-9
            zm = (mom - mom.mean()) / (mom.std() + 1e-9)
            zv = (vol20 - vol20.mean()) / (vol20.std() + 1e-9)
            hidden = cfg.syn_signal * (0.5 * np.tanh(zm) - 0.3 * np.tanh(zv)
                                       - 0.4 * np.tanh(rate_beta * d_rate20[t])) * idio_vol

        ret = beta * mkt + sec_state[sector] + rng.normal(0, idio_vol, size=N) + hidden
        px = px * (1.0 + ret)
        close[t] = px
        ret_hist[t] = ret
        volume[t] = np.exp(rng.normal(13.5, 0.6, size=N)) * (1.0 + 3.0 * np.abs(ret))

    macro = np.stack([
        rate,                                                     # 단기 금리
        rate + 1.2 + 0.4 * np.sin(np.arange(T) / 260.0),          # 장기 금리(흉내)
        1.2 + 0.4 * np.sin(np.arange(T) / 260.0),                 # 장단기 금리차
        100.0 * np.abs(ret_hist).mean(axis=1) * np.sqrt(252),     # 변동성 지수(흉내)
    ], axis=1)

    bench = np.exp(np.cumsum(np.log1p(ret_hist.mean(axis=1))))    # 동일가중 시장지수

    return Panel(
        dates=dates, tickers=[f"SYN{i:03d}" for i in range(N)],
        close=close, volume=volume,
        macro=macro, macro_names=["단기금리", "장기금리", "장단기차", "변동성지수"],
        bench=bench,
        meta={"name": "가상 시장", "source": "synthetic", "synthetic": True,
              "signal": cfg.syn_signal, "sectors": sector.tolist()},
    )


# ===========================================================================
#  2) 실제 데이터
# ===========================================================================
def _cache_path(cfg: Config, key: str) -> str:
    os.makedirs(cfg.cache_dir, exist_ok=True)
    return os.path.join(cfg.cache_dir, f"{key}.npz")


def fetch_fred_csv(series_id: str, start: str, end: str) -> Dict[str, float]:
    """FRED 공개 CSV. API 키가 필요 없습니다."""
    url = (f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
           f"&cosd={start}&coed={end}")
    with urllib.request.urlopen(url, timeout=60) as resp:
        text = resp.read().decode("utf-8", "replace")
    out = {}
    for line in io.StringIO(text).readlines()[1:]:
        parts = line.strip().split(",")
        if len(parts) < 2:
            continue
        try:
            out[parts[0]] = float(parts[1])
        except ValueError:
            continue          # 결측은 '.'로 옵니다
    return out


def load_yfinance(cfg: Config) -> Panel:
    try:
        import pandas as pd
        import yfinance as yf
    except ImportError:
        raise SystemExit("[오류] yfinance/pandas가 필요합니다:  pip install yfinance pandas")

    cache = _cache_path(cfg, f"{cfg.name}_{cfg.start}_{cfg.end}")
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=True)
        print(f"[캐시] {cache} 에서 불러왔습니다. 새로 받으려면 이 파일을 지우세요.")
        return Panel(dates=z["dates"], tickers=list(z["tickers"]), close=z["close"],
                     volume=z["volume"], macro=z["macro"], macro_names=list(z["macro_names"]),
                     bench=(z["bench"] if z["bench"].size else None), meta=json.loads(str(z["meta"])))

    tickers = list(cfg.tickers)
    print(f"[다운로드] {len(tickers)}개 종목 ({cfg.start} ~ {cfg.end}) …")
    raw = yf.download(tickers, start=cfg.start, end=cfg.end, auto_adjust=True,
                      progress=False, group_by="column", threads=True)
    if raw is None or len(raw) == 0:
        raise SystemExit("[오류] 주가를 받지 못했습니다. 종목 코드와 인터넷 연결을 확인하세요.")

    close_df = raw["Close"] if "Close" in raw else raw
    vol_df = raw["Volume"] if "Volume" in raw else close_df * np.nan
    close_df = close_df.dropna(axis=1, how="all")

    # 관측치가 너무 적은 종목은 제외
    keep = [c for c in close_df.columns if close_df[c].notna().sum() >= cfg.min_history]
    dropped = [c for c in close_df.columns if c not in keep]
    if dropped:
        print(f"[알림] 자료가 짧아 제외한 종목 {len(dropped)}개: {', '.join(map(str, dropped[:8]))}"
              + (" …" if len(dropped) > 8 else ""))
    close_df = close_df[keep]
    vol_df = vol_df.reindex(columns=keep)

    idx = close_df.index
    dates = np.array([np.datetime64(str(d)[:10]) for d in idx], dtype="datetime64[D]")

    bench = None
    if cfg.benchmark:
        try:
            b = yf.download(cfg.benchmark, start=cfg.start, end=cfg.end,
                            auto_adjust=True, progress=False)["Close"]
            if hasattr(b, "columns"):
                b = b.iloc[:, 0]
            bench = b.reindex(idx).to_numpy(dtype=float)
        except Exception as e:
            print(f"[알림] 벤치마크({cfg.benchmark})를 받지 못했습니다: {e}")

    macro_cols, macro_names = [], []
    if cfg.use_macro:
        date_str = [str(d) for d in dates]
        for sid in cfg.macro:
            try:
                series = fetch_fred_csv(sid, cfg.start, cfg.end)
                col = np.array([series.get(ds, np.nan) for ds in date_str], dtype=float)
                col = _ffill(col)
                macro_cols.append(col)
                macro_names.append(MACRO_SERIES.get(sid, sid))
                print(f"[매크로] {sid} ({MACRO_SERIES.get(sid, '')}) 확보")
            except Exception as e:
                print(f"[알림] 매크로 {sid} 실패: {e}")

    macro = np.stack(macro_cols, axis=1) if macro_cols else np.zeros((len(dates), 0))
    panel = Panel(
        dates=dates, tickers=[str(c) for c in close_df.columns],
        close=close_df.to_numpy(dtype=float), volume=vol_df.to_numpy(dtype=float),
        macro=macro, macro_names=macro_names, bench=bench,
        meta={"name": f"{cfg.name} ({len(keep)}종목)", "source": "yfinance",
              "synthetic": False, "benchmark": cfg.benchmark,
              "note": "현재 상장된 종목만 담아 생존 편향이 있습니다."},
    )
    np.savez_compressed(
        cache, dates=panel.dates, tickers=np.array(panel.tickers), close=panel.close,
        volume=panel.volume, macro=panel.macro, macro_names=np.array(panel.macro_names),
        bench=(panel.bench if panel.bench is not None else np.array([])),
        meta=json.dumps(panel.meta, ensure_ascii=False),
    )
    print(f"[캐시] {cache} 에 저장했습니다.")
    return panel


def load_csv_dir(cfg: Config) -> Panel:
    """종목별 CSV 폴더를 읽습니다. 파일 이름이 종목 코드가 됩니다. (열: Date, Close[, Volume])"""
    import csv as _csv

    files = sorted(f for f in os.listdir(cfg.csv_dir) if f.lower().endswith(".csv"))
    if not files:
        raise SystemExit(f"[오류] {cfg.csv_dir} 안에 CSV가 없습니다.")

    series = {}
    for fn in files:
        tic = os.path.splitext(fn)[0]
        rows = {}
        with open(os.path.join(cfg.csv_dir, fn), encoding="utf-8-sig") as f:
            rd = _csv.DictReader(f)
            cols = {c.lower().replace(" ", ""): c for c in (rd.fieldnames or [])}
            dcol = next((cols[c] for c in ("date", "날짜", "일자") if c in cols), None)
            ccol = next((cols[c] for c in ("close", "adjclose", "종가") if c in cols), None)
            vcol = next((cols[c] for c in ("volume", "거래량") if c in cols), None)
            if not dcol or not ccol:
                print(f"[알림] {fn}: Date/Close 열을 찾지 못해 건너뜁니다.")
                continue
            for row in rd:
                try:
                    d = str(row[dcol])[:10]
                    p = float(str(row[ccol]).replace(",", ""))
                    v = float(str(row[vcol]).replace(",", "")) if vcol and row.get(vcol) else np.nan
                    rows[d] = (p, v)
                except (ValueError, TypeError):
                    continue
        if len(rows) >= cfg.min_history:
            series[tic] = rows

    if not series:
        raise SystemExit("[오류] 쓸 수 있는 CSV가 없습니다.")

    all_dates = sorted({d for rows in series.values() for d in rows})
    dates = np.array(all_dates, dtype="datetime64[D]")
    tickers = sorted(series)
    close = np.full((len(dates), len(tickers)), np.nan)
    volume = np.full_like(close, np.nan)
    for j, tic in enumerate(tickers):
        for i, d in enumerate(all_dates):
            if d in series[tic]:
                close[i, j], volume[i, j] = series[tic][d]

    return Panel(dates=dates, tickers=tickers, close=close, volume=volume,
                 macro=np.zeros((len(dates), 0)), macro_names=[], bench=None,
                 meta={"name": f"CSV {len(tickers)}종목", "source": "csv", "synthetic": False})


def _ffill(a: np.ndarray) -> np.ndarray:
    out = a.copy()
    last = np.nan
    for i in range(len(out)):
        if np.isfinite(out[i]):
            last = out[i]
        else:
            out[i] = last
    # 앞쪽 결측은 첫 유효값으로
    first = next((v for v in out if np.isfinite(v)), np.nan)
    out[~np.isfinite(out)] = first
    return out


def load_panel(cfg: Config) -> Panel:
    if cfg.source == "synthetic":
        return make_synthetic(cfg)
    if cfg.source == "yfinance":
        return load_yfinance(cfg)
    if cfg.source == "csv":
        return load_csv_dir(cfg)
    raise SystemExit(f"[오류] 모르는 데이터 소스: {cfg.source}")
