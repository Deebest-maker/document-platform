# Local security patch

This directory vendors the published `braces@3.0.3` package solely for the repository's lint toolchain. It is not included in the product bundle.

- Upstream: <https://github.com/micromatch/braces>
- npm tarball: <https://registry.npmjs.org/braces/-/braces-3.0.3.tgz>
- npm integrity: `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`
- License: MIT; the upstream `LICENSE` file is retained unchanged.
- Advisory: <https://github.com/advisories/GHSA-vfj7-8cjw-p6xm>

The local patch adds a parser limit of 100 nested curly braces. This prevents untrusted patterns from creating ASTs deep enough to exhaust the JavaScript call stack in the package's recursive compile, expand, and stringify walkers. Ordinary package source is otherwise unchanged.

Remove this override and vendored copy once the affected dependency chain supplies an upstream release that fixes the advisory and passes the repository verification suite.
