use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde::Serialize;

use crate::document::ApiError;

const MAX_PATCH_BYTES: usize = 4 * 1024 * 1024;
const MAX_HUNKS: usize = 200;
const MAX_DIFF_LINES: usize = 4000;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub repo_root: Option<String>,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub hunks: Vec<GitHunk>,
    pub binary: bool,
    pub truncated: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<GitLine>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLine {
    pub kind: &'static str,
    pub text: String,
    pub old_line: Option<usize>,
    pub new_line: Option<usize>,
}

fn git(directory: &Path, args: &[&str]) -> Result<Output, ApiError> {
    Command::new("git")
        .current_dir(directory)
        .arg("-c")
        .arg("core.quotepath=false")
        .args(args)
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                ApiError::new("git-unavailable", "Git is not installed or not on PATH")
            } else {
                ApiError::new("git-spawn-failed", error.to_string())
            }
        })
}

fn success_text(output: &Output, context: &str) -> Result<String, ApiError> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::new(
            "git-failed",
            format!("{context}: {}", stderr.trim()),
        ));
    }
    // Porcelain status starts with significant spaces, so only trim the ending.
    Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
}

fn optional_line(directory: &Path, args: &[&str]) -> Option<String> {
    let output = git(directory, args).ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() { None } else { Some(text) }
}

fn classify_status(porcelain: &str) -> &'static str {
    let code = porcelain.trim_end();
    if code.is_empty() {
        return "clean";
    }
    if code.starts_with("??") {
        return "untracked";
    }
    if code.starts_with("!!") {
        return "ignored";
    }

    let bytes = code.as_bytes();
    let index = bytes.first().copied().unwrap_or(b' ');
    let worktree = bytes.get(1).copied().unwrap_or(b' ');
    if index == b'D' || worktree == b'D' {
        "deleted"
    } else if index != b' ' && worktree == b' ' {
        "staged"
    } else {
        "modified"
    }
}

fn parse_range(value: &str) -> Option<(usize, usize)> {
    let mut parts = value.split(',');
    let start = parts.next()?.parse().ok()?;
    let count = match parts.next() {
        Some(text) => text.parse().ok()?,
        None => 1,
    };
    if parts.next().is_some() {
        return None;
    }
    Some((start, count))
}

fn parse_hunk_header(line: &str) -> Option<(usize, usize, usize, usize)> {
    let rest = line.strip_prefix("@@ -")?;
    let end = rest.find(" @@")?;
    let mut ranges = rest[..end].split(' ');
    let (old_start, old_lines) = parse_range(ranges.next()?)?;
    let (new_start, new_lines) = parse_range(ranges.next()?.strip_prefix('+')?)?;
    if ranges.next().is_some() {
        return None;
    }
    Some((old_start, old_lines, new_start, new_lines))
}

struct HunkBuilder {
    hunk: GitHunk,
    old_line: usize,
    new_line: usize,
}

impl HunkBuilder {
    fn new(old_start: usize, old_lines: usize, new_start: usize, new_lines: usize) -> Self {
        Self {
            hunk: GitHunk {
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines: Vec::new(),
            },
            old_line: old_start,
            new_line: new_start,
        }
    }
}

fn parse_patch(patch: &str) -> (Vec<GitHunk>, bool) {
    let mut hunks = Vec::new();
    let mut current: Option<HunkBuilder> = None;
    let mut stored_lines = 0usize;
    let mut truncated = false;

    for raw in patch.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if line.starts_with("@@") {
            if let Some(builder) = current.take() {
                hunks.push(builder.hunk);
            }
            if hunks.len() >= MAX_HUNKS {
                truncated = true;
                continue;
            }
            current = parse_hunk_header(line).map(|(old_start, old_lines, new_start, new_lines)| {
                HunkBuilder::new(old_start, old_lines, new_start, new_lines)
            });
            if current.is_none() {
                truncated = true;
            }
            continue;
        }

        let Some(builder) = current.as_mut() else {
            continue;
        };

        let (kind, text, old_line, new_line) = match line.as_bytes().first().copied() {
            Some(b' ') => {
                let values = (
                    "context",
                    &line[1..],
                    Some(builder.old_line),
                    Some(builder.new_line),
                );
                builder.old_line += 1;
                builder.new_line += 1;
                values
            }
            Some(b'-') => {
                let values = ("removed", &line[1..], Some(builder.old_line), None);
                builder.old_line += 1;
                values
            }
            Some(b'+') => {
                let values = ("added", &line[1..], None, Some(builder.new_line));
                builder.new_line += 1;
                values
            }
            Some(b'\\') => continue,
            _ => continue,
        };

        if stored_lines >= MAX_DIFF_LINES {
            truncated = true;
            continue;
        }
        stored_lines += 1;
        builder.hunk.lines.push(GitLine {
            kind,
            text: text.to_string(),
            old_line,
            new_line,
        });
    }

    if let Some(builder) = current {
        hunks.push(builder.hunk);
    }
    (hunks, truncated)
}

fn parse_numstat(output: &Output) -> Result<(usize, usize, bool), ApiError> {
    if !output.status.success() {
        return Ok((0, 0, false));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let Some(line) = text.lines().next() else {
        return Ok((0, 0, false));
    };
    let mut parts = line.split('\t');
    let additions = parts.next().unwrap_or_default();
    let deletions = parts.next().unwrap_or_default();
    if additions == "-" || deletions == "-" {
        return Ok((0, 0, true));
    }
    Ok((
        additions.parse().unwrap_or(0),
        deletions.parse().unwrap_or(0),
        false,
    ))
}

fn limited_patch(stdout: &[u8]) -> (String, bool) {
    if stdout.len() <= MAX_PATCH_BYTES {
        return (String::from_utf8_lossy(stdout).into_owned(), false);
    }
    let limit = stdout[..MAX_PATCH_BYTES]
        .iter()
        .rposition(|byte| *byte == b'\n')
        .unwrap_or(MAX_PATCH_BYTES);
    (String::from_utf8_lossy(&stdout[..limit]).into_owned(), true)
}

#[tauri::command]
pub fn read_git_diff(path: String) -> Result<GitDiff, ApiError> {
    let file = Path::new(&path);
    let file_name = file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ApiError::new("invalid-path", "Document path has no file name"))?;
    let directory: PathBuf = match file.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    };
    if !directory.is_dir() {
        return Err(ApiError::new("not-found", "Document directory does not exist"));
    }

    let root_output = git(&directory, &["rev-parse", "--show-toplevel"])?;
    if !root_output.status.success() {
        return Ok(GitDiff {
            status: "not-repo".into(),
            message: Some("当前文件不在 Git 仓库中。".into()),
            ..GitDiff::default()
        });
    }
    let root = String::from_utf8_lossy(&root_output.stdout).trim().to_string();
    if root.is_empty() {
        return Ok(GitDiff {
            status: "not-repo".into(),
            message: Some("当前文件不在 Git 仓库中。".into()),
            ..GitDiff::default()
        });
    }

    let branch = optional_line(&directory, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let head = optional_line(&directory, &["rev-parse", "--short", "HEAD"]);
    let has_head = git(&directory, &["rev-parse", "--verify", "HEAD"])?
        .status
        .success();

    let status_output = git(
        &directory,
        &[
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--",
            file_name,
        ],
    )?;
    let status_text = success_text(&status_output, "Could not read Git status")?;
    let mut status = classify_status(&status_text);
    if !has_head && status == "clean" {
        status = "unborn";
    }

    let (mut additions, mut deletions, mut binary) = (0, 0, false);
    let mut hunks = Vec::new();
    let mut truncated = false;

    if has_head {
        let numstat = git(&directory, &["diff", "--numstat", "HEAD", "--", file_name])?;
        (additions, deletions, binary) = parse_numstat(&numstat)?;

        if !binary {
            let patch = git(
                &directory,
                &[
                    "diff",
                    "--no-color",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--unified=3",
                    "HEAD",
                    "--",
                    file_name,
                ],
            )?;
            if !patch.status.success() {
                let stderr = String::from_utf8_lossy(&patch.stderr);
                return Err(ApiError::new(
                    "git-failed",
                    format!("Could not read Git diff: {}", stderr.trim()),
                ));
            }
            let (text, clipped) = limited_patch(&patch.stdout);
            let (parsed, parser_truncated) = parse_patch(&text);
            binary = parsed.is_empty()
                && (text.contains("Binary files") || text.contains("GIT binary patch"));
            hunks = parsed;
            truncated = clipped || parser_truncated;
        }
    }

    let message = match status {
        "unborn" => Some("仓库尚无提交，Git 没有可比基线。".to_string()),
        "ignored" => Some("该文件被 Git 忽略。".to_string()),
        _ => None,
    };

    Ok(GitDiff {
        repo_root: Some(root),
        branch,
        head,
        status: status.to_string(),
        additions,
        deletions,
        hunks,
        binary,
        truncated,
        message,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    static TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn temp_dir() -> PathBuf {
        let counter = TEST_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "y-note-git-test-{}-{nanos}-{counter}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn run(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .current_dir(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "Y Note Test")
            .env("GIT_AUTHOR_EMAIL", "test@example.invalid")
            .env("GIT_COMMITTER_NAME", "Y Note Test")
            .env("GIT_COMMITTER_EMAIL", "test@example.invalid")
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?} failed");
    }

    fn init_repo(contents: &str) -> (PathBuf, PathBuf) {
        let dir = temp_dir();
        run(&dir, &["init", "-q"]);
        let path = dir.join("note.md");
        fs::write(&path, contents).unwrap();
        run(&dir, &["add", "note.md"]);
        run(&dir, &["commit", "-q", "-m", "initial"]);
        (dir, path)
    }

    fn diff_of(path: &Path) -> GitDiff {
        read_git_diff(path.to_string_lossy().into_owned()).unwrap()
    }

    #[test]
    fn clean_file_has_no_hunks() {
        if !git_available() {
            return;
        }
        let (dir, path) = init_repo("# Title\n\noriginal\n");
        let diff = diff_of(&path);
        assert_eq!(diff.status, "clean");
        assert!(diff.hunks.is_empty());
        assert_eq!(diff.additions, 0);
        assert_eq!(diff.deletions, 0);
        assert!(diff.repo_root.is_some());
        assert!(diff.branch.is_some());
        assert!(diff.head.is_some());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn modified_file_returns_hunk_and_counts() {
        if !git_available() {
            return;
        }
        let (dir, path) = init_repo("# Title\n\noriginal\n\nkept\n");
        fs::write(&path, "# Title\n\nchanged\n\nkept\n").unwrap();
        let diff = diff_of(&path);
        assert_eq!(diff.status, "modified");
        assert_eq!(diff.additions, 1);
        assert_eq!(diff.deletions, 1);
        assert!(!diff.binary);
        assert_eq!(diff.hunks.len(), 1);
        let hunk = &diff.hunks[0];
        assert_eq!((hunk.old_start, hunk.old_lines), (1, 5));
        assert_eq!((hunk.new_start, hunk.new_lines), (1, 5));
        assert!(hunk
            .lines
            .iter()
            .any(|line| line.kind == "removed" && line.text == "original"));
        assert!(hunk
            .lines
            .iter()
            .any(|line| line.kind == "added" && line.text == "changed"));
        let removed = hunk
            .lines
            .iter()
            .find(|line| line.kind == "removed")
            .unwrap();
        let added = hunk.lines.iter().find(|line| line.kind == "added").unwrap();
        assert_eq!(removed.old_line, Some(3));
        assert_eq!(removed.new_line, None);
        assert_eq!(added.old_line, None);
        assert_eq!(added.new_line, Some(3));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn staged_change_is_reported_against_head() {
        if !git_available() {
            return;
        }
        let (dir, path) = init_repo("one\n");
        fs::write(&path, "one\ntwo\n").unwrap();
        run(&dir, &["add", "note.md"]);
        let diff = diff_of(&path);
        assert_eq!(diff.status, "staged");
        assert_eq!(diff.additions, 1);
        assert_eq!(diff.deletions, 0);
        assert!(diff
            .hunks
            .iter()
            .flat_map(|hunk| &hunk.lines)
            .any(|line| line.kind == "added" && line.text == "two"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn untracked_and_deleted_files_are_classified() {
        if !git_available() {
            return;
        }
        let (dir, path) = init_repo("one\ntwo\n");

        let new_path = dir.join("new.md");
        fs::write(&new_path, "new\n").unwrap();
        let untracked = diff_of(&new_path);
        assert_eq!(untracked.status, "untracked");
        assert!(untracked.hunks.is_empty());

        fs::remove_file(&path).unwrap();
        let deleted = diff_of(&path);
        assert_eq!(deleted.status, "deleted");
        assert_eq!(deleted.additions, 0);
        assert_eq!(deleted.deletions, 2);
        assert!(!deleted.hunks.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn outside_a_repository_is_reported_without_error() {
        if !git_available() {
            return;
        }
        let dir = temp_dir();
        let path = dir.join("note.md");
        fs::write(&path, "plain\n").unwrap();
        let diff = diff_of(&path);
        assert_eq!(diff.status, "not-repo");
        assert!(diff.repo_root.is_none());
        assert!(diff.hunks.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn parses_multiple_hunks_and_no_newline_markers() {
        let patch = concat!(
            "diff --git a/note.md b/note.md\n",
            "index 111..222 100644\n",
            "--- a/note.md\n",
            "+++ b/note.md\n",
            "@@ -1,2 +1,2 @@\n",
            "-one\n",
            "+ONE\n",
            " two\n",
            "@@ -10 +10,2 @@\n",
            " ten\n",
            "+eleven\n",
            "\\ No newline at end of file\n",
        );
        let (hunks, truncated) = parse_patch(patch);
        assert!(!truncated);
        assert_eq!(hunks.len(), 2);
        assert_eq!((hunks[0].old_start, hunks[0].old_lines), (1, 2));
        assert_eq!(hunks[1].lines.len(), 2);
        let context = &hunks[1].lines[0];
        assert_eq!(context.kind, "context");
        assert_eq!(context.old_line, Some(10));
        assert_eq!(context.new_line, Some(10));
        let added = &hunks[1].lines[1];
        assert_eq!(added.kind, "added");
        assert_eq!(added.new_line, Some(11));
    }

    #[test]
    fn parses_zero_length_ranges() {
        let (hunks, _) = parse_patch("@@ -0,0 +1,2 @@\n+first\n+second\n");
        assert_eq!(hunks.len(), 1);
        assert_eq!((hunks[0].old_start, hunks[0].old_lines), (0, 0));
        assert_eq!(hunks[0].lines[1].new_line, Some(2));
    }
}
