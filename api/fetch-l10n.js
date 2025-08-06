import { Client } from '@notionhq/client';
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

const notion = new Client({ auth: NOTION_TOKEN });

const ALL_LANG_URL = 'https://l10n-ap-southeast-1.s3.ap-southeast-1.amazonaws.com/goface/stu/all_lang.json';

// 下載並解析 all_lang.json
async function fetchAllLangData() {
    return new Promise((resolve, reject) => {
        https.get(ALL_LANG_URL, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed['zh-TW'] || {});
                } catch (err) {
                    reject(new Error('JSON 解析錯誤: ' + err.message));
                }
            });
        }).on('error', (err) => {
            reject(new Error('下載失敗: ' + err.message));
        });
    });
}

// 解決 Notion 一次最多拉 100 筆資料的問題
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
        const zhTWMap = await fetchAllLangData(); // { messageKey1: "中文", messageKey2: "中文"... }

        const pages = await fetchAllPages(NOTION_DATABASE_ID);
        let updatedCount = 0;

        for (const page of pages) {
            const props = page.properties;
            const messageKey = props["message key"]?.rich_text?.[0]?.text?.content;
            const currentZh = props["zh-TW"]?.rich_text?.[0]?.text?.content || '';

            if (!messageKey) continue; // 無 message key 的資料跳過
            const newZh = zhTWMap[messageKey];

            // 如果有新 zh-TW 資料且目前欄位是空的，就寫入
            if (newZh && !currentZh) {
                await notion.pages.update({
                    page_id: page.id,
                    properties: {
                        "zh-TW": {
                            rich_text: [{ text: { content: newZh } }],
                        },
                    },
                });
                updatedCount++;
            }
        }

        res.status(200).json({ message: `✅ 更新完成，補入 zh-TW 共 ${updatedCount} 筆` });
    } catch (error) {
        console.error("❌ 發生錯誤:", error);
        res.status(500).json({ error: '伺服器錯誤', detail: error.message });
    }
}
