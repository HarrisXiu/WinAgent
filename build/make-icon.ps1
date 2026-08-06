param([string]$srcPng, [string]$outDir)
Add-Type -AssemblyName System.Drawing
$sizes = 16, 32, 48, 256
foreach ($s in $sizes) {
  $img = [System.Drawing.Image]::FromFile($srcPng)
  $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($img, 0, 0, $s, $s)
  $out = Join-Path $outDir "icon_$s.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "ok $s -> $out"
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
}
