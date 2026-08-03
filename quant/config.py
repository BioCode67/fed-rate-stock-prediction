# -*- coding: utf-8 -*-
"""
config.py — 실험 설정 한곳 모으기

실험은 '설정을 바꿔가며 여러 번 돌리는 일'입니다. 그래서 바꿀 값은 전부 여기 모아 두고,
결과 폴더에 설정을 그대로 저장해 나중에 "이 결과는 무슨 설정이었지?"를 알 수 있게 합니다.

프리셋(preset)은 자주 쓰는 설정 묶음입니다.
  demo   : 인터넷 없이 도는 가상 데이터. 파이프라인 점검용.
  us     : 미국 대형주 + 미국 매크로 지표
  kr     : 한국 대형주 + 미국 매크로 지표(국내 금리는 FRED에 없어 미국 금리를 씁니다)
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from typing import List, Optional


# ---------------------------------------------------------------------------
#  종목 목록
#  주의: 지금 살아남아 이름이 알려진 종목만 담았으므로 생존 편향이 있습니다.
#        (망하거나 상장폐지된 종목이 빠져 있어 성적이 실제보다 좋게 나옵니다)
#        결과를 해석할 때 반드시 이 점을 함께 밝혀야 합니다.
# ---------------------------------------------------------------------------
US_TICKERS = [
    "AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "TSLA", "AVGO", "ADBE", "CRM",
    "ORCL", "CSCO", "INTC", "AMD", "QCOM", "TXN", "IBM", "NOW", "INTU", "AMAT",
    "JPM", "BAC", "WFC", "GS", "MS", "C", "AXP", "BLK", "SCHW", "USB",
    "JNJ", "UNH", "PFE", "MRK", "ABBV", "LLY", "TMO", "ABT", "BMY", "AMGN",
    "PG", "KO", "PEP", "WMT", "COST", "MCD", "NKE", "SBUX", "TGT", "CL",
    "XOM", "CVX", "COP", "SLB", "EOG", "CAT", "DE", "BA", "HON", "GE",
    "LMT", "UPS", "UNP", "RTX", "MMM", "NEE", "DUK", "SO", "D", "AEP",
]

KR_TICKERS = [
    "005930.KS", "000660.KS", "373220.KS", "207940.KS", "005380.KS", "005490.KS",
    "051910.KS", "006400.KS", "035420.KS", "035720.KS", "000270.KS", "068270.KS",
    "105560.KS", "055550.KS", "086790.KS", "316140.KS", "138040.KS", "323410.KS",
    "012330.KS", "003670.KS", "010130.KS", "011200.KS", "009150.KS", "066570.KS",
    "034730.KS", "015760.KS", "017670.KS", "030200.KS", "032640.KS", "011070.KS",
    "010950.KS", "096770.KS", "267250.KS", "010140.KS", "042660.KS", "047050.KS",
    "028260.KS", "018260.KS", "128940.KS", "302440.KS", "091990.KQ", "196170.KQ",
    "247540.KQ", "086520.KQ", "058470.KQ", "240810.KQ", "357780.KQ", "078600.KQ",
]

# FRED 매크로 시리즈 (키 없이 CSV로 받을 수 있습니다)
MACRO_SERIES = {
    "DGS2": "미국 2년물 국채금리",
    "DGS10": "미국 10년물 국채금리",
    "T10Y2Y": "장단기 금리차(10년-2년)",
    "VIXCLS": "VIX 변동성 지수",
    "BAMLH0A0HYM2": "하이일드 신용 스프레드",
    "DTWEXBGS": "달러 지수",
}


@dataclass
class Config:
    # --- 실험 이름/경로 ---
    name: str = "demo"
    out_dir: str = "runs"
    cache_dir: str = "data_cache"
    seed: int = 42

    # --- 데이터 ---
    source: str = "synthetic"          # synthetic | yfinance | csv
    tickers: List[str] = field(default_factory=list)
    benchmark: Optional[str] = None    # 예: "^GSPC", "^KS11" (없으면 동일가중 유니버스가 벤치마크)
    start: str = "2010-01-01"
    end: str = "2025-01-01"
    macro: List[str] = field(default_factory=lambda: ["DGS2", "DGS10", "T10Y2Y", "VIXCLS"])
    min_history: int = 300             # 이보다 짧은 종목은 제외
    csv_dir: str = ""                  # source=csv 일 때 종목별 CSV가 있는 폴더

    # 가상 데이터(source=synthetic) 설정
    syn_n_days: int = 3800
    syn_n_stocks: int = 60
    # 숨은 신호 세기. 실제로 측정해 보고 정한 값입니다.
    #   0.00 → IC 0.000 (예측할 거리가 전혀 없는 시장. 도구 점검용)
    #   0.10 → IC 0.042 (실제 퀀트에서 '쓸 만하다'고 보는 수준)
    #   0.30 → IC 0.223 (현실에는 없는 강한 신호. 모델이 배우는지 확인할 때만)
    syn_signal: float = 0.10
    # 섹터 요인이 며칠씩 이어지는 정도. 0이면 하루짜리(예측 불가).
    # 0.85처럼 올리면 '섹터 모멘텀'이라는 강한 예측 신호가 저절로 생깁니다.
    syn_sector_persist: float = 0.0

    # --- 라벨 ---
    horizon: int = 5                   # 며칠 뒤 수익률을 맞힐지
    label: str = "excess"              # excess(시장 대비 초과수익) | raw
    label_transform: str = "rank"      # rank(횡단면 순위 -1~1) | zscore | raw

    # --- 특징 ---
    seq_len: int = 32                  # 시퀀스 모델이 되돌아보는 길이
    use_macro: bool = True
    winsorize: float = 0.02            # 양쪽 2%를 잘라 이상치 영향 줄이기

    # --- 모델 ---
    model: str = "mlp"                 # mlp | gru | transformer | ridge | lgbm
    hidden: int = 128
    layers: int = 2
    dropout: float = 0.2
    lr: float = 1e-3
    weight_decay: float = 1e-4
    epochs: int = 30
    patience: int = 6                  # 조기 종료
    batch_dates: int = 16              # 한 번에 처리할 '날짜' 수 (횡단면 손실을 쓰므로 날짜 단위)
    loss: str = "ic"                   # ic(랭킹 상관 최대화) | mse | bce
    ensemble: int = 3                  # 시드를 바꿔 여러 번 학습해 평균
    device: str = "auto"               # auto | cuda | cpu
    amp: bool = True                   # GPU에서 bf16 혼합정밀도 사용

    # --- 워크포워드 검증 ---
    train_days: int = 1000             # 학습 창 길이 (0이면 처음부터 전부 = 확장 창)
    valid_days: int = 250              # 조기 종료용 검증 구간
    test_days: int = 250               # 한 번 학습으로 예측할 구간 (이만큼 굴리고 재학습)
    start_frac: float = 0.5            # 전체의 이 지점부터 검증 시작
    embargo: int = 5                   # 학습과 검증 사이에 비우는 날 수(누수 방지 완충)

    # --- 포트폴리오 백테스트 ---
    rebalance: int = 5                 # 며칠마다 갈아탈지
    top_k: int = 10                    # 상위 몇 종목을 살지
    long_short: bool = False           # True면 하위 종목 공매도까지
    weighting: str = "equal"           # equal | score
    cost_per_side: float = 0.0005      # 편도 거래비용 0.05%
    slippage: float = 0.0005           # 슬리피지 0.05%
    max_weight: float = 0.2            # 한 종목 최대 비중

    def resolved_device(self) -> str:
        if self.device != "auto":
            return self.device
        try:
            import torch
            return "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            return "cpu"

    def run_dir(self) -> str:
        return os.path.join(self.out_dir, self.name)

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, path: str) -> "Config":
        with open(path, encoding="utf-8") as f:
            return cls(**json.load(f))


# ---------------------------------------------------------------------------
#  프리셋
# ---------------------------------------------------------------------------
def preset(name: str) -> Config:
    if name == "demo":
        return Config(
            name="demo", source="synthetic", syn_n_days=2600, syn_n_stocks=60,
            syn_signal=0.10, model="mlp", epochs=20, ensemble=2, train_days=800,
            valid_days=200, test_days=200, start_frac=0.5,
        )
    if name == "us":
        return Config(
            name="us", source="yfinance", tickers=list(US_TICKERS), benchmark="^GSPC",
            start="2010-01-01", end="2025-01-01", model="gru", epochs=40, ensemble=3,
        )
    if name == "kr":
        return Config(
            name="kr", source="yfinance", tickers=list(KR_TICKERS), benchmark="^KS11",
            start="2012-01-01", end="2025-01-01", model="gru", epochs=40, ensemble=3,
        )
    raise SystemExit(f"[오류] 모르는 프리셋: {name} (demo | us | kr)")
