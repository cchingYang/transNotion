import JSZip from 'jszip';
import { Client } from "@notionhq/client";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

const notion = new Client({ auth: NOTION_TOKEN });


const langMap = {
    "zh-TW": "l10n-zh-tw",
    "en-US": "manual-en-US",
    "ja-JP": "manual-ja-JP"
};

export default async function handler(req, res) {
    const locales = {
        "zh-TW": {},
        "en-US": {},
        "ja-JP": {}
    };

    try {
        // 查詢 Notion 資料庫
        const response = await notion.databases.query({
            database_id: NOTION_DATABASE_ID,
            filter: {
                property: "product",
                select: { equals: "Portal" }
            }
        });

        // 轉換語系資料
        for (const page of response.results) {
            const key = page.properties["message key"]?.rich_text?.[0]?.text?.content?.trim();
            if (!key) continue;

            for (const [lang, fieldName] of Object.entries(langMap)) {
                const text = page.properties[fieldName]?.rich_text?.[0]?.text?.content?.trim();
                if (text) {
                    locales[lang][key] = text;
                }
            }
        }

        // 建立 zip 檔
        const zip = new JSZip();
        for (const [lang, content] of Object.entries(locales)) {
            zip.file(`${lang}.json`, JSON.stringify(content, null, 2));
        }
        const zipData = await zip.generateAsync({ type: 'nodebuffer' });

        // 設定 response header
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="locales.zip"');
        res.status(200).send(zipData);

    } catch (err) {
        console.error("❌ 錯誤:", err);
        res.status(500).json({ error: "發生錯誤", detail: err.message });
    }
}
