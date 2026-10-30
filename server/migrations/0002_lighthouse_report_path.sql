-- H2-6: link report HTML Lighthouse per URL (manifest.json lhci).
ALTER TABLE lighthouse_results ADD COLUMN report_path TEXT;
