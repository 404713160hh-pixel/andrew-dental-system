param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$PdfOutput
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$reportPath = (Resolve-Path -LiteralPath $Path).Path
if ([System.IO.Path]::GetExtension($reportPath).ToLowerInvariant() -ne '.docx') {
    throw 'This helper updates .docx documents only.'
}
$pdfPath = $null
if ($PdfOutput) {
    $pdfPath = [System.IO.Path]::GetFullPath($PdfOutput)
    if ([System.IO.Path]::GetExtension($pdfPath).ToLowerInvariant() -ne '.pdf') {
        throw 'PdfOutput must have a .pdf extension.'
    }
    $null = [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($pdfPath))
}
$wordApp = $null
$reportDoc = $null
try {
    $wordApp = New-Object -ComObject Word.Application
    $wordApp.Visible = $false
    $wordApp.DisplayAlerts = 0
    $wordApp.AutomationSecurity = 3
    $reportDoc = $wordApp.Documents.Open($reportPath, $false, $false, $false)
    if ($reportDoc.ReadOnly) { throw 'The document is read-only; use an editable copy.' }
    for ($pass = 0; $pass -lt 2; $pass++) {
        foreach ($firstStory in $reportDoc.StoryRanges) {
            $story = $firstStory
            while ($null -ne $story) {
                $null = $story.Fields.Update()
                $story = $story.NextStoryRange
            }
        }
        $reportDoc.Repaginate()
        for ($i = 1; $i -le $reportDoc.TablesOfContents.Count; $i++) {
            $reportDoc.TablesOfContents.Item($i).Update()
        }
        for ($i = 1; $i -le $reportDoc.TablesOfFigures.Count; $i++) {
            $reportDoc.TablesOfFigures.Item($i).Update()
        }
        $reportDoc.Repaginate()
        for ($i = 1; $i -le $reportDoc.TablesOfContents.Count; $i++) {
            $reportDoc.TablesOfContents.Item($i).UpdatePageNumbers()
        }
        for ($i = 1; $i -le $reportDoc.TablesOfFigures.Count; $i++) {
            $reportDoc.TablesOfFigures.Item($i).UpdatePageNumbers()
        }
    }
    # Field updates can instantiate Word's built-in link styles. Set both the
    # normal and visited styles after the final update, using stable style IDs.
    foreach ($styleNumber in -86, -87) {
        $linkStyle = $reportDoc.Styles.Item($styleNumber)
        $linkStyle.Font.Color = 0
        $linkStyle.Font.Underline = 0
    }
    $reportDoc.Save()
    if ($pdfPath) { $reportDoc.ExportAsFixedFormat($pdfPath, 17) }
    [pscustomobject]@{
        path = $reportPath
        pages = $reportDoc.ComputeStatistics(2)
        contents = $reportDoc.TablesOfContents.Count
        figureLists = $reportDoc.TablesOfFigures.Count
        pdf = $pdfPath
    } | ConvertTo-Json -Compress
}
finally {
    if ($null -ne $reportDoc) {
        $reportDoc.Close(0)
        $null = [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($reportDoc)
    }
    if ($null -ne $wordApp) {
        $wordApp.Quit(0)
        $null = [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordApp)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
