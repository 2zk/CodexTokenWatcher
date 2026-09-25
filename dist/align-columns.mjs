// 全角（East Asian Wide / Fullwidth）文字の簡易判定。端末上で2桁として表示される。
const WIDE_CHAR = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;
/** 端末上の表示幅を返す。全角文字は2桁として数える。 */
export function displayWidth(text) {
    let width = 0;
    for (const char of text) {
        width += WIDE_CHAR.test(char) ? 2 : 1;
    }
    return width;
}
/**
 * 各行のセルを表示幅でそろえて連結する（column -t 相当）。
 * セルは左寄せで、最終セルは埋めない。
 */
export function alignColumns(rows) {
    const widths = [];
    for (const row of rows) {
        row.forEach((cell, index) => {
            widths[index] = Math.max(widths[index] ?? 0, displayWidth(cell));
        });
    }
    return rows.map((row) => row
        .map((cell, index) => index === row.length - 1
        ? cell
        : cell + " ".repeat(widths[index] - displayWidth(cell)))
        .join(""));
}
