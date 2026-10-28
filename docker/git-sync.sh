#!/bin/sh
# Brings SYNC_DIR (default: the working directory) up to date with REPO_URL, then runs the
# container's command. A container's first start fetches over the code baked into its image and
# every later start pulls again. If GitHub can't be reached the app starts on the code it has.
# BUILD_CMD runs only when the fetch changed the checked-out commit.
set -u

if [ -n "${REPO_URL:-}" ]; then
    (
        cd "${SYNC_DIR:-.}" || exit 1
        [ -d .git ] || git -c init.defaultBranch=main init -q
        old=$(git rev-parse -q --verify HEAD)
        if git fetch -q --depth 1 "$REPO_URL" "${REPO_BRANCH:-main}"; then
            git reset -q --hard FETCH_HEAD
            new=$(git rev-parse HEAD)
            echo "git-sync: running $REPO_URL at $new"
            if [ "$old" != "$new" ] && [ -n "${BUILD_CMD:-}" ]; then
                sh -c "$BUILD_CMD" || echo "git-sync: BUILD_CMD failed" >&2
            fi
        else
            echo "git-sync: could not fetch $REPO_URL; starting with the code already here" >&2
        fi
    )
fi

exec "$@"
