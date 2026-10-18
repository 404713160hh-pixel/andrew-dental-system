"""Audit CSU Word report structure; field refresh and rendered review are separate.

Requires lxml. Checks XML structure, not whether cached page numbers are current.
"""
import argparse
import json
from pathlib import Path
import re
import sys
import zipfile
from lxml import etree

NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W = '{' + NS['w'] + '}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('docx', type=Path)
    args = parser.parse_args()
    failures = []
    with zipfile.ZipFile(args.docx) as archive:
        if archive.testzip():
            failures.append('DOCX archive integrity failed')
        document = etree.fromstring(archive.read('word/document.xml'))
        styles = etree.fromstring(archive.read('word/styles.xml'))
        numbering = etree.fromstring(archive.read('word/numbering.xml'))
        parts = [document] + [etree.fromstring(archive.read(name)) for name in archive.namelist()
            if re.fullmatch(r'word/(?:header|footer)\d+\.xml', name)]
    sections = document.xpath('//w:sectPr', namespaces=NS)
    if len(sections) < 3:
        failures.append('Cover, front matter and body require separate sections')
    for i, section in enumerate(sections):
        page = section.find(W+'pgSz')
        margins = section.find(W+'pgMar')
        if page is None or abs(int(page.get(W+'w', '0'))-11906) > 3 or abs(int(page.get(W+'h', '0'))-16838) > 3 or page.get(W+'orient', 'portrait') != 'portrait':
            failures.append(f'Section {i+1} is not portrait A4')
        for side, expected in [('top', 1417), ('bottom', 1417), ('left', 1531), ('right', 1531)]:
            if margins is None or abs(int(margins.get(W+side, '0'))-expected) > 3:
                failures.append(f'Section {i+1} {side} margin differs from reference')
    page_formats = []
    for section in sections:
        item = section.find(W+'pgNumType')
        page_formats.append({} if item is None else {'format': item.get(W+'fmt', 'decimal'), 'start': item.get(W+'start')})
    if not any(item.get('format') == 'upperRoman' and item.get('start') == '1' for item in page_formats):
        failures.append('Upper-Roman front matter restart is missing')
    if not any(item.get('format') == 'decimal' and item.get('start') == '1' for item in page_formats[2:]):
        failures.append('Arabic body restart is missing')
    # Word can localize style IDs (Normal -> a1); use its semantic default flag.
    normal_candidates = styles.xpath('./w:style[@w:type="paragraph" and @w:default="1"]', namespaces=NS)
    normal = normal_candidates[0] if normal_candidates else None
    spacing = normal.find('w:pPr/w:spacing', NS) if normal is not None else None
    if spacing is None or spacing.get(W+'lineRule') != 'exact' or spacing.get(W+'line') != '520':
        failures.append('Normal body style must use exactly 26pt line spacing')
    size = normal.find('w:rPr/w:sz', NS) if normal is not None else None
    if size is None or size.get(W+'val') != '24':
        failures.append('Normal body style must use 12pt type')
    fields = []
    for part in parts:
        fields.extend(part.xpath('//w:instrText/text()', namespaces=NS))
        fields.extend(part.xpath('//w:fldSimple/@w:instr', namespaces=NS))
    if not any(re.search(r'TOC\s+.*\\o\s+"1-2"', code, re.I) for code in fields):
        failures.append('A real two-level TOC field is missing')
    if not any(re.match(r'\s*PAGE(?:\s|$)', code, re.I) for code in fields):
        failures.append('Footer PAGE fields are missing')
    if not numbering.xpath('//w:lvl[@w:ilvl="2"]', namespaces=NS):
        failures.append('Three-level numbering definitions are missing')
    figure_count = sum(bool(re.search(r'\bSEQ\s+Figure\b', code, re.I)) for code in fields)
    figure_list = any(re.search(r'TOC\s+.*\\c\s+"Figure"', code, re.I) for code in fields)
    # A figure list can intentionally be disabled, so this is reported rather than required.
    data_tables = 0
    for table in document.xpath('//w:tbl', namespaces=NS):
        rows = table.findall(W+'tr')
        if rows and rows[0].find('w:trPr/w:tblHeader', NS) is not None:
            data_tables += 1
            for border in table.xpath('.//w:tblBorders/w:left|.//w:tblBorders/w:right|.//w:tblBorders/w:insideV', namespaces=NS):
                if border.get(W+'val', 'nil') not in ('nil', 'none'):
                    failures.append('A data table has vertical borders')
    used_styles = set()
    for part in parts:
        used_styles.update(part.xpath('//w:pStyle/@w:val|//w:rStyle/@w:val', namespaces=NS))
    if normal is not None:
        used_styles.add(normal.get(W+'styleId'))
    for style in styles.findall(W+'style'):
        name = style.find(W+'name')
        if name is not None and name.get(W+'val', '').lower().replace(' ', '') in ('hyperlink', 'followedhyperlink'):
            used_styles.add(style.get(W+'styleId'))
    colored = []
    for style in styles.findall(W+'style'):
        if style.get(W+'styleId') in used_styles:
            name = style.find(W+'name')
            if name is not None and name.get(W+'val', '').lower() == 'title':
                for border in style.xpath('./w:pPr/w:pBdr/*', namespaces=NS):
                    if border.get(W+'val', 'nil') not in ('nil', 'none'):
                        failures.append('The Title style has a decorative border')
            for color in style.findall('.//'+W+'color'):
                value = color.get(W+'val', 'auto').lower()
                if value not in ('000000', 'auto') and not (len(value) == 6 and value[0:2] == value[2:4] == value[4:6]):
                    colored.append(style.get(W+'styleId'))
    if colored:
        failures.append('Active styles use colored text: ' + ', '.join(sorted(set(colored))))
    result = {'ok': not failures, 'sections': len(sections), 'pageNumberFormats': page_formats,
        'figureCaptions': figure_count, 'figureListField': figure_list, 'dataTablesWithRepeatedHeaders': data_tables,
        'failures': failures,
        'remainingReview': 'Refresh and save all fields; render every page and verify page numbers, link targets, fonts, tables and cover visually.'}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['ok'] else 1)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf8')
        sys.stderr.reconfigure(encoding='utf8')
    main()
