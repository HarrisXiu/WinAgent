// DocxBuilder module — Word document generation utilities
// Currently uses PowerShell COM automation; will be replaced with docx-rs in future

pub fn create_word_document(path: &str, title: &str, content: &str) -> Result<(), String> {
    use std::process::Command;
    let cmd = format!(
        "$word = New-Object -ComObject Word.Application; \
         $word.Visible = $false; \
         $doc = $word.Documents.Add(); \
         $sel = $word.Selection; \
         $sel.Style = 'Title'; \
         $sel.TypeText('{}'); \
         $sel.TypeParagraph(); \
         $sel.Style = 'Normal'; \
         $sel.TypeText('{}'); \
         $doc.SaveAs('{}'); \
         $doc.Close(); \
         $word.Quit()",
        title.replace('\'', "''"),
        content.replace('\'', "''"),
        path.replace('\'', "''")
    );
    let output = Command::new("powershell").args(["-NoProfile", "-Command", &cmd]).output();
    match output {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(String::from_utf8_lossy(&o.stderr).to_string()),
        Err(e) => Err(e.to_string()),
    }
}
