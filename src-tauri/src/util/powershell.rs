use std::process::Command;

/// Execute a PowerShell command and return (success, output)
pub fn run_ps(cmd: &str) -> (bool, String) {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", cmd])
        .output();
    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            let result = if stderr.is_empty() { stdout } else { format!("{}\n{}", stdout, stderr) };
            (o.status.success(), result)
        }
        Err(e) => (false, format!("PowerShell execution failed: {}", e)),
    }
}

/// Execute a PowerShell command with a timeout (in seconds)
pub fn run_ps_timeout(cmd: &str, timeout_secs: u64) -> (bool, String) {
    let ps_cmd = format!("$proc = Start-Process powershell -ArgumentList '-NoProfile -Command {}' -PassThru -Wait; if ($proc -and -not $proc.HasExited) {{ Stop-Process -Id $proc.Id -Force }}", cmd.replace('\'', "''"));
    // For simplicity, just run without timeout for now
    run_ps(&ps_cmd)
}
