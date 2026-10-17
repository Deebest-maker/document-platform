"""Async subprocess runner.

Used by real engines (LibreOffice in M4B) to run a native command safely.
The runner:

    * accepts a fixed `argv` list — never a string, never shell=True;
    * puts the child in its own process group (POSIX setsid) so the
      whole group can be signalled on cancel/timeout;
    * sends SIGTERM then SIGKILL after a grace period on cancellation
      or timeout, to the whole group;
    * returns (returncode, stdout_bytes, stderr_bytes) on normal exit;
    * raises `ProcessorError(CANCELLED)` on cancellation, `LIMIT_EXCEEDED`
      on timeout.

M4A does not spawn LibreOffice. The runner lives here now so engine
tests can drive it directly and the API/engine wiring is ready for M4B.
"""

from __future__ import annotations

import asyncio
import os
import signal
from collections.abc import Mapping
from dataclasses import dataclass

from app.errors import ErrorCode, ProcessorError

# On POSIX this is SIGKILL; the attribute is absent on Windows. The processor
# only runs on Linux in production (container) and in CI; the `getattr` lets
# the module import cleanly on Windows for local type checks.
_SIGKILL = getattr(signal, "SIGKILL", signal.SIGTERM)


@dataclass(slots=True, frozen=True)
class ProcessResult:
    returncode: int
    stdout: bytes
    stderr: bytes


async def run_process(
    argv: list[str],
    *,
    cwd: str,
    env: Mapping[str, str],
    timeout_seconds: float,
    cancel_event: asyncio.Event | None = None,
    sigterm_grace_seconds: float = 3.0,
) -> ProcessResult:
    """Run `argv` as a subprocess with hard limits and cancellation.

    `argv` must be a non-empty list; the first element is the executable.
    No shell is invoked. The child is spawned via `setsid` so it is the
    leader of its own process group, and SIGTERM/SIGKILL target that
    group with `os.killpg`.

    Raises:
        ProcessorError(LIMIT_EXCEEDED): the child did not finish within
            `timeout_seconds`.
        ProcessorError(CANCELLED): the caller fired `cancel_event`.
        ProcessorError(INTERNAL): any other unexpected OS failure.
    """
    if not argv:
        raise ProcessorError(ErrorCode.INTERNAL)

    process = await asyncio.create_subprocess_exec(
        *argv,
        cwd=cwd,
        env=dict(env),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        stdin=asyncio.subprocess.DEVNULL,
        start_new_session=True,
    )
    pgid = _pgid_for(process)
    try:
        done, pending = await asyncio.wait(
            _watchers(process, cancel_event),
            timeout=timeout_seconds,
            return_when=asyncio.FIRST_COMPLETED,
        )
    except asyncio.CancelledError:
        _kill_group(pgid)
        process.kill()
        raise
    for task in pending:
        task.cancel()
    cancelled = cancel_event is not None and cancel_event.is_set()
    timed_out = not done
    if cancelled or timed_out:
        _kill_group(pgid)
        try:
            await asyncio.wait_for(process.wait(), timeout=sigterm_grace_seconds)
        except TimeoutError:
            _kill_group(pgid, _SIGKILL)
            await process.wait()
        if cancelled:
            raise ProcessorError(ErrorCode.CANCELLED)
        raise ProcessorError(ErrorCode.LIMIT_EXCEEDED)
    returncode = await process.wait()
    stdout_bytes, stderr_bytes = await process.communicate()
    return ProcessResult(
        returncode=returncode, stdout=stdout_bytes, stderr=stderr_bytes
    )


def _pgid_for(process: asyncio.subprocess.Process) -> int:
    pid = process.pid
    try:
        # POSIX-only: os.getpgid is absent on Windows; the processor only
        # runs on Linux in production and in CI.
        return int(os.getpgid(pid))  # type: ignore[attr-defined,unused-ignore]
    except (ProcessLookupError, AttributeError):
        # AttributeError: os.getpgid absent on Windows; fall back to pid.
        return pid


def _kill_group(pgid: int, sig: int = signal.SIGTERM) -> None:
    try:
        # POSIX-only; see `_pgid_for` for rationale.
        os.killpg(pgid, sig)  # type: ignore[attr-defined,unused-ignore]
    except AttributeError:
        # Windows: no process groups; kill the process directly.
        try:
            os.kill(pgid, sig)
        except (ProcessLookupError, PermissionError, OSError):
            pass
    except (ProcessLookupError, PermissionError):
        return


def _watchers(
    process: asyncio.subprocess.Process, cancel_event: asyncio.Event | None
) -> list[asyncio.Task[object]]:
    tasks: list[asyncio.Task[object]] = [asyncio.create_task(process.wait())]
    if cancel_event is not None:
        tasks.append(asyncio.create_task(cancel_event.wait()))
    return tasks
