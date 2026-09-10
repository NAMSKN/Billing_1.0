"""Background worker helper to keep the UI thread responsive (Req 25.7).

Runs a callable on a :class:`~PySide6.QtCore.QThreadPool` worker thread and
delivers the result or error back via Qt signals (marshaled to the receiving
thread). Use for potentially slow operations — large PDF rendering, backup,
restore — so the PySide6 UI thread is never blocked.

Fast local operations (ordinary CRUD on the embedded SQLite database) do not
need this; run them directly (design section 31).

Lifetime note: the signals object is kept alive in a module-level registry
until delivery completes, so the queued cross-thread signal is not dropped when
the (auto-deleted) ``QRunnable`` is destroyed by the pool.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from PySide6.QtCore import QObject, QRunnable, QThreadPool, Signal

# Keeps signal objects alive until their result/error has been delivered.
_pending: set[_WorkerSignals] = set()


class _WorkerSignals(QObject):
    finished = Signal(object)  # emits the callable's result
    failed = Signal(object)  # emits the raised exception


class _Worker(QRunnable):
    def __init__(self, fn: Callable[[], Any], signals: _WorkerSignals) -> None:
        super().__init__()
        self._fn = fn
        self._signals = signals

    def run(self) -> None:
        try:
            result = self._fn()
        except Exception as exc:  # noqa: BLE001 - forward any error to the UI callback
            self._signals.failed.emit(exc)
        else:
            self._signals.finished.emit(result)


def run_in_background(
    fn: Callable[[], Any],
    on_done: Callable[[Any], None],
    on_error: Callable[[BaseException], None],
    *,
    pool: QThreadPool | None = None,
) -> None:
    """Run ``fn`` off the UI thread; call ``on_done``/``on_error`` with the outcome.

    Args:
        fn: The work to perform (no arguments; close over inputs).
        on_done: Called with ``fn``'s return value on success.
        on_error: Called with the exception on failure.
        pool: Thread pool to use; defaults to the global instance.
    """
    signals = _WorkerSignals()
    _pending.add(signals)

    def _done(result: Any) -> None:
        try:
            on_done(result)
        finally:
            _pending.discard(signals)

    def _failed(exc: BaseException) -> None:
        try:
            on_error(exc)
        finally:
            _pending.discard(signals)

    signals.finished.connect(_done)
    signals.failed.connect(_failed)

    worker = _Worker(fn, signals)
    (pool if pool is not None else QThreadPool.globalInstance()).start(worker)


__all__ = ["run_in_background"]
