"""Jobs-root and per-job workspace management.

The jobs root is a single absolute directory the processor owns on disk.
Every per-job workspace is a direct child of it; nothing outside it is
ever read or written. Before the janitor or any workspace helper acts,
the jobs root is validated against a sentinel marker and refused if it
looks dangerous (root filesystem, /tmp, the service's own install
directory, a symlink, a path containing foreign entries, etc.).

Design rules:
    * Jobs root must be absolute, exist, be a real directory (not a
      symlink), and contain a sentinel file.
    * `validate_jobs_root` raises `UnsafeJobsRoot` on any check failure.
    * `create_workspace` creates `<jobs_root>/<job_id>` with mode 0o700.
    * `remove_workspace` only removes a path that is a direct child of
      the validated jobs root, is a real directory, is not a symlink,
      and does not escape via `..`.
    * No shell interpolation, no user filename ever hits the filesystem.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path


class UnsafeJobsRoot(Exception):
    """Raised when the configured jobs root fails safety checks."""


# Paths we refuse to treat as a jobs root, regardless of configuration.
_FORBIDDEN_ROOTS: frozenset[Path] = frozenset(
    {
        Path("/"),
        Path("/tmp"),
        Path("/var/tmp"),
        Path("/root"),
        Path("/home"),
        Path("/usr"),
        Path("/etc"),
        Path("/app"),  # processor install dir in the container
    }
)


def validate_jobs_root(root: Path, sentinel: str) -> Path:
    """Return the realpath of `root` after confirming it is safe to use.

    - `root` must be absolute.
    - `root` must not equal or be a parent of a forbidden path.
    - `root` must exist as a real directory (not a symlink).
    - `root` must contain a file named `sentinel` as a regular file
      (not a symlink). The sentinel's content is not inspected.
    """
    if not root.is_absolute():
        raise UnsafeJobsRoot("jobs root must be an absolute path")

    try:
        resolved = root.resolve(strict=True)
    except FileNotFoundError as exc:
        raise UnsafeJobsRoot("jobs root does not exist") from exc

    if resolved in _FORBIDDEN_ROOTS:
        raise UnsafeJobsRoot("jobs root points at a forbidden system path")

    # Refuse to treat a symlinked root as safe; `resolve()` follows symlinks
    # so compare the resolved path against the original.
    if root.is_symlink():
        raise UnsafeJobsRoot("jobs root must not be a symlink")

    if not resolved.is_dir():
        raise UnsafeJobsRoot("jobs root is not a directory")

    marker = resolved / sentinel
    if not marker.exists():
        raise UnsafeJobsRoot("jobs root is missing the required sentinel file")
    if marker.is_symlink() or not marker.is_file():
        raise UnsafeJobsRoot("jobs root sentinel is not a regular file")

    return resolved


def _assert_direct_child(root: Path, candidate: Path) -> Path:
    """Resolve `candidate` and confirm it is a direct child of `root`.

    Returns the resolved path. Raises `UnsafeJobsRoot` on any mismatch,
    on a symlink, or when the candidate escapes the root via `..`.
    """
    if candidate.is_symlink():
        raise UnsafeJobsRoot("workspace path must not be a symlink")
    resolved = candidate.resolve(strict=False)
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise UnsafeJobsRoot("workspace escapes the jobs root") from exc
    if resolved.parent != root:
        raise UnsafeJobsRoot("workspace must be a direct child of the jobs root")
    return resolved


def create_workspace(root: Path, job_id: str) -> Path:
    """Create `<root>/<job_id>` with restrictive permissions and return it.

    `job_id` must be the random identifier minted by `auth.new_job_id`;
    user filenames are never passed in here. Still, this function verifies
    that `job_id` contains only URL-safe characters so a bug upstream
    cannot create a workspace outside the root.
    """
    if not job_id or any(c in job_id for c in "/\\\x00.") or job_id in ("", ".", ".."):
        raise UnsafeJobsRoot("workspace name is not a safe identifier")
    for ch in job_id:
        if not (ch.isalnum() or ch in "-_"):
            raise UnsafeJobsRoot("workspace name is not URL-safe")

    workspace = root / job_id
    workspace.mkdir(mode=0o700, parents=False, exist_ok=False)
    # Belt-and-braces: confirm what we created is still a direct child.
    return _assert_direct_child(root, workspace)


def remove_workspace(root: Path, workspace: Path) -> bool:
    """Remove a workspace directory. Returns True if something was removed.

    Refuses to act if `workspace` is not a direct child of the validated
    jobs root, is a symlink, or escapes `root`. Never follows symlinks
    during the recursive remove.
    """
    try:
        resolved = _assert_direct_child(root, workspace)
    except UnsafeJobsRoot:
        return False
    if not resolved.exists():
        return False
    shutil.rmtree(resolved, ignore_errors=False, onerror=_fail_on_symlink)
    return True


def _fail_on_symlink(func: object, path: str, exc_info: object) -> None:
    """shutil.rmtree error callback that re-raises after logging context.

    We deliberately re-raise instead of swallowing so an unexpected
    permissions/filesystem issue surfaces during the janitor pass.
    """
    # shutil.rmtree passes a 3-tuple here; we only need to re-raise.
    err = exc_info[1] if isinstance(exc_info, tuple) and len(exc_info) >= 2 else None
    if isinstance(err, OSError):
        raise err
    raise OSError(f"failed to remove workspace entry at {path}")


def direct_children(root: Path) -> list[Path]:
    """List non-symlink direct children of a validated jobs root.

    Used by the janitor; never returns the sentinel or anything else that
    is not a directory.
    """
    try:
        entries = os.scandir(root)
    except FileNotFoundError:
        return []
    children: list[Path] = []
    with entries:
        for entry in entries:
            if entry.is_symlink():
                continue
            if not entry.is_dir(follow_symlinks=False):
                continue
            children.append(Path(entry.path))
    return children
