// test_interactive.ts
import * as readline from 'readline';
import fetch from 'node-fetch';

const baseUri = "http://localhost:2000";

// 顧客データの型定義
interface CustomerData {
    name: string;
    age: number;
    balance: number; // 残高を追加
}

// メニューを表示する関数
function showMenu() {
    console.log("選択してください:");
    console.log("1. GET (顧客情報取得)");
    console.log("2. SET (顧客情報登録/更新)");
    console.log("3. DELETE (顧客情報削除)");
    console.log("4. GET ALL KEYS (全顧客ID取得)");
    console.log("5. 会計処理");
    console.log("6. 残高照会");
    console.log("7. 終了");
}

// 非同期処理を扱うための async function
async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // 質問を表示し、入力を得る Promise を返す関数
    function question(query: string): Promise<string> {
        return new Promise((resolve) => {
            rl.question(query, (answer) => {
                resolve(answer);
            });
        });
    }

    while (true) {
        showMenu();
        const choice = await question("操作番号: ");

        switch (choice) {
            case "1": { // GET
                const getKey = await question("取得する顧客IDを入力してください: ");
                try {
                    const response = await fetch(`${baseUri}/get?key=${getKey}`);
                    console.log(`GET Response Status Code: ${response.status}`);
                    const text = await response.text();
                    console.log(`GET Response Body: ${text}`);
                } catch (error: any) {
                    console.error("GET Request Failed:", error.message);
                    if (error instanceof Error && error.cause && (error.cause as any).code) {
                        console.error("  Error Code:", (error.cause as any).code);
                    }
                }
                break;
            }
            case "2": { // SET
                const setKey = await question("登録/更新する顧客IDを入力してください: ");
                const setName = await question("顧客名を入力: ");
                const setAge = await question("年齢を入力: ");
                const setInitialBalance = await question("初期残高を入力: "); // 初期残高の入力を追加

                const setData = {
                    name: setName,
                    age: parseInt(setAge, 10), // 必ず整数に変換
                    balance: parseFloat(setInitialBalance) // 初期残高をfloatに変換
                };
                const setJsonData = JSON.stringify(setData);

                try {
                    const response = await fetch(`${baseUri}/set?key=${setKey}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: setJsonData
                    });
                    console.log(`SET Response Status Code: ${response.status}`);
                    const text = await response.text();
                    console.log("SET Response Body:", text)
                } catch (error: any) {
                    console.error("SET Request Failed:", error.message);
                    if (error instanceof Error && error.cause && (error.cause as any).code) {
                        console.error("  Error Code:", (error.cause as any).code);
                    }
                }

                break;
            }
            case "3": { // DELETE
                const deleteKey = await question("削除する顧客IDを入力してください:");
                try {
                    const response = await fetch(`${baseUri}/delete?key=${deleteKey}`, { method: 'DELETE' });
                    console.log(`DELETE Response Status Code: ${response.status}`);
                    const text = await response.text()
                    console.log("DELETE Response Body:", text);
                } catch (error: any) {
                    console.error("DELETE Request Failed:", error.message);
                    if (error instanceof Error && error.cause && (error.cause as any).code) {
                        console.error("  Error Code:", (error.cause as any).code);
                    }
                }
                break;
            }
            case "4": { // GET ALL
                try {
                    const response = await fetch(`${baseUri}/keys`);
                    console.log(`GET ALL KEYS Response Status Code: ${response.status}`);
                    const text = await response.text()
                    console.log("GET ALL KEYS Response Body:", text);

                } catch (error: any) {
                    console.error("GET ALL KEYS Request Failed:", error.message);
                    if (error instanceof Error && error.cause && (error.cause as any).code) {
                        console.error("  Error Code:", (error.cause as any).code);
                    }
                }
                break;
            }

            case "5": { // 会計処理
                const customerId = await question("会計処理を行う顧客IDを入力してください: ");
                try {
                    const response = await fetch(`${baseUri}/get?key=${customerId}`);
                    if (!response.ok) {
                        console.log(`顧客ID ${customerId} は存在しません。`);
                        break;
                    }

                    const customerData: CustomerData = await response.json() as CustomerData;

                    console.log(`\n--- 会計処理 ---`);
                    console.log(`顧客ID: ${customerId}`);
                    console.log(`顧客名: ${customerData.name}`);
                    console.log(`残高: ${customerData.balance} 円`);

                    const purchaseAmount = await question("購入金額を入力してください: ");
                    const amount = parseFloat(purchaseAmount); // Parse to float for currency

                    if (isNaN(amount) || amount <= 0) {
                        console.log("無効な金額です。 正の数値を入力してください。");
                        break;
                    }

                    if (amount > customerData.balance) {
                        console.log("残高が不足しています。");
                        break;
                    }

                    const paymentMethod = await question("支払い方法 (現金/カード) を入力してください: ");

                    console.log(`\n--- 請求明細 ---`);
                    console.log(`購入金額: ${amount} 円`);
                    console.log(`支払い方法: ${paymentMethod}`);
                    console.log(`残高: ${customerData.balance - amount} 円`);

                    const confirm = await question("上記でよろしいですか？ (y/n): ");

                    if (confirm.toLowerCase() === 'y') {
                        console.log("会計処理が完了しました。");

                        // 残高を更新する処理
                        const updatedCustomerData = { ...customerData, balance: customerData.balance - amount };
                        const updateJsonData = JSON.stringify(updatedCustomerData);

                        try {
                            const updateResponse = await fetch(`${baseUri}/set?key=${customerId}`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: updateJsonData
                            });

                            if (!updateResponse.ok) {
                                console.error("残高更新に失敗しました。");
                                break;
                            }
                            console.log("残高が更新されました。");
                        } catch (updateError: any) {
                            console.error("残高更新リクエストに失敗しました:", updateError.message);
                            if (updateError instanceof Error && updateError.cause && (updateError.cause as any).code) {
                                console.error("  Error Code:", (updateError.cause as any).code);
                            }
                            break; //会計処理自体を中断
                        }
                        // ここでデータベースを更新するコードを追加 (顧客の購入履歴を保存するなど)
                        // 例：await updateCustomerPurchaseHistory(customerId, amount);

                        //領収書の表示
                        console.log("\n--- 領収書 ---");
                        console.log(`顧客ID: ${customerId}`);
                        console.log(`顧客名: ${customerData.name}`);
                        console.log(`購入金額: ${amount} 円`);
                        console.log(`支払い方法: ${paymentMethod}`);
                        console.log(`残高: ${customerData.balance - amount} 円`);
                        console.log("ありがとうございました。");

                    } else {
                        console.log("会計処理がキャンセルされました。");
                    }

                } catch (error: any) {
                    console.error("会計処理エラー:", error.message);
                    if (error instanceof Error && error.cause && (error.cause as any).code) {
                        console.error("  Error Code:", (error.cause as any).code);
                    }
                }
                break;
            }
            case "6": { // 残高照会
                const customerId = await question("残高照会を行う顧客IDを入力してください: ");
                try {
                    const response = await fetch(`${baseUri}/get?key=${customerId}`);
                    if (!response.ok) {
                        console.log(`顧客ID ${customerId} は存在しません。`);
                        break;
                    }

                    const customerData: CustomerData = await response.json() as CustomerData;
                    console.log(`\n--- 残高照会 ---`);
                    console.log(`顧客ID: ${customerId}`);
                    console.log(`顧客名: ${customerData.name}`);
                    console.log(`残高: ${customerData.balance} 円`);

                } catch (error: any) {
                    console.error("残高照会エラー:", error.message);
                    if (error instanceof Error && error.cause && (error.cause as any).code) {
                        console.error("  Error Code:", (error.cause as any).code);
                    }
                }
                break;
            }
            case "7": { // 終了
                console.log("終了します。");
                rl.close();
                return;
            }
            default: {
                console.log("無効な選択です。");
            }
        }

        console.log("");
    }
}

main();