import sys
from pathlib import Path

import pytest

from app.jobs.workspace import (
    UnsafeJobsRoot,
    create_workspace,
    direct_children,
    remove_workspace,
    validate_jobs_root,
)

_NEEDS_SYMLINK = pytest.mark.skipif(
    sys.platform == "win32",
    reason="Windows requires Developer Mode or admin for symlinks",
)


def _make_root(tmp_path: Path, sentinel: str = ".sentinel") -> Path:
    root = tmp_path / "jobs"
    root.mkdir()
    (root / sentinel).write_text("ok")
    return root


def test_validate_accepts_a_dedicated_directory_with_sentinel(
    tmp_path: Path,
) -> None:
    root = _make_root(tmp_path)
    assert validate_jobs_root(root, ".sentinel") == root.resolve()


def test_validate_rejects_relative_path(tmp_path: Path) -> None:
    with pytest.raises(UnsafeJobsRoot):
        validate_jobs_root(Path("relative/path"), ".sentinel")


def test_validate_rejects_missing_sentinel(tmp_path: Path) -> None:
    root = tmp_path / "jobs"
    root.mkdir()
    with pytest.raises(UnsafeJobsRoot):
        validate_jobs_root(root, ".sentinel")


@_NEEDS_SYMLINK
def test_validate_rejects_sentinel_as_symlink(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    (root / ".sentinel").unlink()
    (root / ".sentinel").symlink_to(root)
    with pytest.raises(UnsafeJobsRoot):
        validate_jobs_root(root, ".sentinel")


@_NEEDS_SYMLINK
def test_validate_rejects_root_as_symlink(tmp_path: Path) -> None:
    target = tmp_path / "real"
    target.mkdir()
    (target / ".sentinel").write_text("ok")
    link = tmp_path / "linked"
    link.symlink_to(target)
    with pytest.raises(UnsafeJobsRoot):
        validate_jobs_root(link, ".sentinel")


def test_validate_rejects_forbidden_system_roots() -> None:
    for root in (Path("/"), Path("/tmp"), Path("/root"), Path("/home"), Path("/etc")):
        with pytest.raises(UnsafeJobsRoot):
            validate_jobs_root(root, ".sentinel")


def test_create_and_remove_workspace_round_trip(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    workspace = create_workspace(root.resolve(), "ABC-123_xyz")
    assert workspace.exists() and workspace.is_dir()
    assert workspace.parent == root.resolve()
    if sys.platform != "win32":
        # NTFS does not enforce POSIX permission bits.
        assert workspace.stat().st_mode & 0o777 == 0o700
    removed = remove_workspace(root.resolve(), workspace)
    assert removed is True
    assert not workspace.exists()


def test_create_workspace_rejects_dotdot_and_slashes(tmp_path: Path) -> None:
    root = _make_root(tmp_path).resolve()
    for bad in ["..", ".", "", "a/b", "a\\b", "a\x00b", "a/../b", "a.b"]:
        with pytest.raises(UnsafeJobsRoot):
            create_workspace(root, bad)


def test_remove_workspace_refuses_outside_root(tmp_path: Path) -> None:
    root = _make_root(tmp_path).resolve()
    other = tmp_path / "elsewhere"
    other.mkdir()
    assert remove_workspace(root, other) is False
    assert other.exists()


@_NEEDS_SYMLINK
def test_remove_workspace_refuses_symlinked_entry(tmp_path: Path) -> None:
    root = _make_root(tmp_path).resolve()
    target = tmp_path / "real"
    target.mkdir()
    link = root / "linked"
    link.symlink_to(target)
    assert remove_workspace(root, link) is False
    assert target.exists()


@_NEEDS_SYMLINK
def test_direct_children_omits_sentinel_and_symlinks(tmp_path: Path) -> None:
    root = _make_root(tmp_path).resolve()
    (root / "a").mkdir()
    (root / "b").mkdir()
    target = tmp_path / "outside"
    target.mkdir()
    (root / "link").symlink_to(target)
    (root / "orphan-file").write_text("x")
    names = {entry.name for entry in direct_children(root)}
    assert names == {"a", "b"}
