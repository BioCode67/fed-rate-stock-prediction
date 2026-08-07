# -*- coding: utf-8 -*-
"""
run.py — 실행 입구 (명령줄)

예시
    # 인터넷 없이 파이프라인 점검 (가상 데이터)
    python -m quant.run --preset demo

    # 미국 대형주, GRU, GPU 사용
    python -m quant.run --preset us --model gru --device cuda --epochs 40

    # 한국 대형주, 트랜스포머, 20일 예측 / 20일마다 갈아타기
    python -m quant.run --preset kr --model transformer --horizon 20 --rebalance 20

    # 신호가 없는 가상 시장에서 IC가 0 근처로 나오는지 점검 (아주 중요한 확인)
    python -m quant.run --preset demo --syn-signal 0 --name demo_nosignal

    # 비교군
    python -m quant.run --preset demo --model ridge
    python -m quant.run --preset demo --model lgbm

결과는 runs/<이름>/ 에 그림·JSON으로 저장되고, web_export.json은 웹 화면에서 불러올 수 있습니다.
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np

from .backtest import run_backtest
from .config import Config, preset
from .data import load_panel
from .export_web import export
from .features import build_features, build_labels
from .metrics import daily_ic, quantile_returns, summarize_ic
from .report import make_figures, print_report, save_json
from .train import train_walk_forward


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="퀀트 주가 예측·모의투자 파이프라인 (교육/연구용)",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    p.add_argument("--preset", default="demo", help="demo | us | kr")
    p.add_argument("--config", default=None, help="설정 JSON 파일 경로 (있으면 프리셋 대신 사용)")
    p.add_argument("--name", default=None, help="실험 이름 (결과 폴더 이름)")

    g = p.add_argument_group("데이터")
    g.add_argument("--source", choices=["synthetic", "yfinance", "csv"])
    g.add_argument("--csv-dir", dest="csv_dir")
    g.add_argument("--start"); g.add_argument("--end")
    g.add_argument("--tickers", help="쉼표로 구분한 종목 목록 (기본 프리셋 목록 대신)")
    g.add_argument("--benchmark")
    g.add_argument("--syn-signal", dest="syn_signal", type=float,
                   help="가상 데이터의 숨은 신호 세기 (0이면 예측 불가능한 시장)")
    g.add_argument("--syn-stocks", dest="syn_n_stocks", type=int)
    g.add_argument("--syn-days", dest="syn_n_days", type=int)

    g = p.add_argument_group("모델·학습")
    g.add_argument("--model", choices=["mlp", "gru", "transformer", "ridge", "lgbm"])
    g.add_argument("--loss", choices=["ic", "mse", "bce"])
    g.add_argument("--device", choices=["auto", "cuda", "cpu"])
    g.add_argument("--epochs", type=int); g.add_argument("--hidden", type=int)
    g.add_argument("--layers", type=int); g.add_argument("--dropout", type=float)
    g.add_argument("--lr", type=float); g.add_argument("--seq-len", dest="seq_len", type=int)
    g.add_argument("--ensemble", type=int); g.add_argument("--seed", type=int)
    g.add_argument("--batch-dates", dest="batch_dates", type=int)
    g.add_argument("--no-amp", dest="amp", action="store_false", default=None)

    g = p.add_argument_group("검증·포트폴리오")
    g.add_argument("--horizon", type=int); g.add_argument("--rebalance", type=int)
    g.add_argument("--top-k", dest="top_k", type=int)
    g.add_argument("--long-short", dest="long_short", action="store_true", default=None)
    g.add_argument("--cost", dest="cost_per_side", type=float, help="편도 거래비용 (0.0005 = 0.05%%)")
    g.add_argument("--slippage", type=float)
    g.add_argument("--train-days", dest="train_days", type=int)
    g.add_argument("--test-days", dest="test_days", type=int)
    g.add_argument("--valid-days", dest="valid_days", type=int)
    g.add_argument("--start-frac", dest="start_frac", type=float)

    p.add_argument("--out-dir", dest="out_dir", default=None)
    p.add_argument("--no-figures", action="store_true", help="그림 저장 건너뛰기")
    p.add_argument("--permute-labels", action="store_true",
                   help="정답을 날짜별로 뒤섞어 학습합니다. 특징과 정답의 관계가 끊기므로 "
                        "IC가 0 근처로 나와야 정상입니다. 0이 아니면 코드에 누수가 있다는 뜻입니다.")
    return p


def make_config(args) -> Config:
    cfg = Config.load(args.config) if args.config else preset(args.preset)
    for k, v in vars(args).items():
        if k in ("preset", "config", "no_figures", "tickers", "permute_labels"):
            continue
        if v is not None and hasattr(cfg, k):
            setattr(cfg, k, v)
    if args.tickers:
        cfg.tickers = [t.strip() for t in args.tickers.split(",") if t.strip()]
    return cfg


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    cfg = make_config(args)
    np.random.seed(cfg.seed)

    print("=" * 78)
    print(f" 퀀트 파이프라인 — {cfg.name}")
    print("=" * 78)

    # 1) 데이터
    panel = load_panel(cfg)
    print(panel.describe())

    # 2) 팩터와 정답
    X, names, valid = build_features(panel, cfg)
    fwd, y, ok = build_labels(panel, cfg, valid)
    print(f"[특징] {len(names)}개 — {', '.join(names[:8])}"
          + (f" … 외 {len(names) - 8}개" if len(names) > 8 else ""))
    print(f"[정답] {cfg.horizon}일 뒤 "
          + ("시장 대비 초과수익" if cfg.label == "excess" else "수익률")
          + f"를 {cfg.label_transform} 로 변환 · 학습 가능한 자리 {int(ok.sum()):,}개")

    # 누수 점검용: 정답의 '날짜'를 뒤섞습니다. 특징과 정답의 연결이 끊기므로
    # 제대로 만든 파이프라인이라면 IC가 0 근처로 나와야 합니다.
    if args.permute_labels:
        rng = np.random.default_rng(cfg.seed + 777)
        perm = rng.permutation(len(y))
        y, fwd, ok = y[perm], fwd[perm], ok[perm]
        print("[점검] 정답을 날짜별로 뒤섞었습니다(permutation test). "
              "IC가 0 근처가 아니면 코드에 누수가 있다는 뜻입니다.")

    # 3) 학습 (워크포워드)
    res = train_walk_forward(X, y, fwd, ok, cfg)
    lo, hi = res["test_range"]

    # 4) 예측력 평가
    ic, ric = daily_ic(res["scores"][lo:hi], fwd[lo:hi], ok[lo:hi])
    ic_stats = summarize_ic(ic, ric, sample_every=cfg.horizon)
    q_returns = quantile_returns(res["scores"][lo:hi], fwd[lo:hi], ok[lo:hi])

    # 5) 포트폴리오 백테스트
    bt = run_backtest(panel, res["scores"], ok, cfg, lo, hi)

    # 6) 보고
    print_report(cfg, panel, bt, ic_stats, q_returns, res["folds"])

    out = cfg.run_dir()
    os.makedirs(out, exist_ok=True)
    cfg.save(os.path.join(out, "config.json"))
    save_json(os.path.join(out, "report.json"), {
        "config": {k: v for k, v in vars(cfg).items()},
        "ic": ic_stats, "quantiles": list(map(float, q_returns)),
        "performance": {"net": bt["perf_net"], "gross": bt["perf_gross"],
                        "benchmark": bt["perf_bench"], "excess": bt["perf_excess"]},
        "folds": res["folds"],
        "data": panel.meta,
    })
    if not args.no_figures:
        try:
            paths = make_figures(out, bt, ic, q_returns, panel.dates[lo:hi])
            print(f"[그림] {', '.join(os.path.basename(p) for p in paths)} → {out}/")
        except Exception as e:
            print(f"[알림] 그림 저장을 건너뜁니다: {e}")

    export(cfg, panel, res, bt, ic, ic_stats, q_returns, os.path.join(out, "web_export.json"))
    print(f"[저장] {out}/ 에 config.json, report.json, web_export.json 이 있습니다.\n")
    print("교육·연구용입니다. 실제 투자 판단에 사용하지 마십시오.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
