import { Client } from '@notionhq/client';
import https from 'https';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

const notion = new Client({ auth: NOTION_TOKEN });

const ALL_LANG_URL = 'https://l10n-ap-southeast-1.s3.ap-southeast-1.amazonaws.com/goface/stu/all_lang.json';

// 下載並解析 all_lang.json 中的 "zh-TW"
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

// 拉出 Notion 所有資料（支援分頁）
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
        const zhTWMap = await fetchAllLangData(); // { key1: "中文", key2: "中文" }

        const pages = await fetchAllPages(NOTION_DATABASE_ID);
        const existingKeys = new Set(
            pages.map(page => page.properties["message key"]?.rich_text?.[0]?.text?.content)
                .filter(Boolean)
        );

        let newCount = 0;
        let updatedCount = 0;

        // 先補進 Notion 中缺少的 key
        for (const [key, zhValue] of Object.entries(zhTWMap)) {
            if (!existingKeys.has(key)) {
                await notion.pages.create({
                    parent: { database_id: NOTION_DATABASE_ID },
                    properties: {
                        "message key": {
                            rich_text: [{ text: { content: key } }],
                        },
                        "zh-TW": {
                            rich_text: [{ text: { content: zhValue } }],
                        },
                    },
                });
                newCount++;
            }
        }

        // 再補齊原有頁面中缺漏的 zh-TW 欄位
        for (const page of pages) {
            const props = page.properties;
            const messageKey = props["message key"]?.rich_text?.[0]?.text?.content;

            if (!messageKey) continue;

            const newZh = zhTWMap[messageKey];

            // ✅ 強制覆蓋 zh-TW 欄位，不管原本有沒有值，以l10n為主
            if (newZh) {
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

        res.status(200).json({
            message: `✅ Notion 資料庫同步完成`,
            added: newCount,
            updated: updatedCount,
        });
    } catch (error) {
        console.error("❌ 發生錯誤:", error);
        res.status(500).json({ error: '伺服器錯誤', detail: error.message });
    }
}
