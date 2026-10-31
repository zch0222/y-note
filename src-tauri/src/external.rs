use std::process::Command;

use url::Url;

use crate::document::ApiError;

fn validate(url: &str) -> Result<Url, ApiError> {
    let parsed = Url::parse(url)
        .map_err(|error| ApiError::new("invalid-url", format!("Invalid URL: {error}")))?;
    match parsed.scheme() {
        "http" | "https" if parsed.host_str().is_some() => Ok(parsed),
        "mailto" => Ok(parsed),
        _ => Err(ApiError::new(
            "unsupported-scheme",
            "Only http, https and mailto links can be opened externally",
        )),
    }
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), ApiError> {
    validate(&url)?;
    launch(&url)
}

#[cfg(target_os = "windows")]
fn launch(url: &str) -> Result<(), ApiError> {
    // rundll32 resolves the system URL handler without a shell or cmd.exe.
    Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn()
        .map(|_| ())
        .map_err(|error| ApiError::new("open-failed", error.to_string()))
}

#[cfg(target_os = "macos")]
fn launch(url: &str) -> Result<(), ApiError> {
    Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| ApiError::new("open-failed", error.to_string()))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch(url: &str) -> Result<(), ApiError> {
    Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| ApiError::new("open-failed", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_web_and_mail_links() {
        assert!(validate("https://example.com/a?b=1").is_ok());
        assert!(validate("http://localhost:1420").is_ok());
        assert!(validate("mailto:hello@example.com").is_ok());
    }

    #[test]
    fn rejects_script_file_and_relative_urls() {
        for url in [
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "data:text/html,<script>alert(1)</script>",
            "./relative.md",
            "https://",
            "ftp://example.com/file",
        ] {
            assert!(validate(url).is_err(), "{url} should be rejected");
        }
    }
}
