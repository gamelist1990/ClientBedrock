// test_interactive.ts
import * as readline from 'readline';
import fetch from 'node-fetch'; // node-fetch を使う

const baseUri = "http://localhost:2000";

// メニューを表示する関数
function showMenu() {
  console.log("選択してください:");
  console.log("1. GET (データの取得)");
  console.log("2. SET (データのセット)");
  console.log("3. DELETE (データの削除)");
  console.log("4. GET ALL KEYS (すべてのキーを取得)");
  console.log("5. 終了");
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

  async function getDynamicData(keyType: string): Promise<any> {
    let data: { [key: string]: any } = {};
    let addMore = true;

    while (addMore) {
      const fieldName = await question(`'${keyType}' に追加するフィールド名を入力してください (完了するには空Enter): `);
      if (!fieldName) {
        addMore = false;
        break;
      }

      const fieldType = await question(`'${fieldName}' の型を選択してください (string, number, boolean, json): `);

      let fieldValue: any;
      switch (fieldType.toLowerCase()) {
        case 'string':
          fieldValue = await question(`'${fieldName}' の文字列を入力してください: `);
          break;
        case 'number':
          fieldValue = parseFloat(await question(`'${fieldName}' の数値を入力してください: `));
          if (isNaN(fieldValue)) {
            console.log("無効な数値です。スキップします。");
            continue;
          }
          break;
        case 'boolean':
          const boolInput = await question(`'${fieldName}' の真偽値 (true/false) を入力してください: `);
          fieldValue = boolInput.toLowerCase() === 'true';
          break;
        case 'json':
          try {
            const jsonInput = await question(`'${fieldName}' のJSONを入力してください: `);
            fieldValue = JSON.parse(jsonInput);
          } catch (e) {
            console.log("無効な JSON です。スキップします。");
            continue;
          }
          break;
        default:
          console.log("無効な型です。スキップします。");
          continue;
      }

      data[fieldName] = fieldValue;
    }

    return data;
  }

  while (true) {
    showMenu();
    const choice = await question("操作番号: ");

    switch (choice) {
      case "1": { // GET
        const getKey = await question("取得するキーを入力してください: ");
        try {
          const response = await fetch(`${baseUri}/get?key=${getKey}`);
          console.log(`GET Response Status Code: ${response.status}`);
          const text = await response.text();
          console.log(`GET Response Body: ${text}`);
        } catch (error: any) {
          console.error("GET Request Failed:", error.message);
          if (error instanceof Error && error.cause && (error.cause as any).code) {
            console.error("  Error Code:", (error.cause as any).code); // 例: ECONNREFUSED など
          }
        }
        break; // switch から抜ける
      }
      case "2": { // SET
        const setKey = await question("セットするキーを入力してください: ");
        const setData = await getDynamicData(setKey);

        if (Object.keys(setData).length === 0) {
          console.log("データが入力されませんでした。");
          break;
        }

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

        break; //switch 文から抜ける
      }
      case "3": { // DELETE
        const deleteKey = await question("削除するキーを入力してください:");
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
        break;//switch
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
        break; //switch
      }

      case "5": { // 終了
        console.log("終了します。");
        rl.close();
        return; // main 関数から抜ける (プログラム終了)
      }
      default: {
        console.log("無効な選択です。");
      }
    }

    console.log(""); // 改行
  }
}

main();