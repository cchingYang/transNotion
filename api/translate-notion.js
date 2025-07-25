import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const notion = new Client({ auth: NOTION_TOKEN });

async function translateText(text, targetLang) {
    const url = `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_API_KEY}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Referer': 'https://portal.goface.me', // 解決 Referer 限制
        },
        body: JSON.stringify({
            q: text,
            target: targetLang,
            format: 'text',
        }),
    });

    const data = await res.json();
    if (data.error) {
        throw new Error(`Google Translate API Error: ${JSON.stringify(data.error)}`);
    }

    return data.data.translations[0].translatedText;
}
//解決notion一次只能拉100筆資料的問題
async function fetchAllPages(databaseId) {
    let results = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
        const response = await notion.databases.query({
            database_id: databaseId,
            start_cursor: startCursor,
        });

        results = results.concat(response.results);
        hasMore = response.has_more;
        startCursor = response.next_cursor;
    }

    return results;
}

export default async function handler(req, res) {
    try {
        const pages = await fetchAllPages(NOTION_DATABASE_ID);

        let updatedCount = 0;

        for (const page of pages) {
            const props = page.properties;
            const zh = props["zh-TW"]?.rich_text?.[0]?.text?.content || "";

            if (!zh) continue;

            const en = props["en-US"]?.rich_text?.[0]?.text?.content;
            const ja = props["ja-JP"]?.rich_text?.[0]?.text?.content;

            if (en && ja) continue;

            const enTranslated = en || await translateText(zh, "en");
            const jaTranslated = ja || await translateText(zh, "ja");

            await notion.pages.update({
                page_id: page.id,
                properties: {
                    "en-US": {
                        rich_text: [{ text: { content: enTranslated } }],
                    },
                    "ja-JP": {
                        rich_text: [{ text: { content: jaTranslated } }],
                    },
                },
            });

            updatedCount++;
        }

        res.status(200).json({ message: `✅ 更新完成，總共翻譯 ${updatedCount} 筆資料` });
    } catch (error) {
        console.error("❌ 發生錯誤:", error);
        res.status(500).json({ error: '伺服器錯誤', detail: error.message });
    }
}
