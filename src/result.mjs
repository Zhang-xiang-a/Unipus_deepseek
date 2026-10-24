// 答题小结核验。文案来自课程配置 uiTexts，换平台用词时改配置即可。
export function isAnswerSummary(text, {summary = '答题小结'} = {}) {
  return new RegExp(summary).test(text) && /答题情况/.test(text) && /已作答|客观题正确/.test(text);
}

export async function readAnswerResult({page, gate, wait, attempts = 1, uiTexts = {}}) {
  const summaryText = uiTexts.answerSummary || '答题小结';
  const entryText = uiTexts.answerSummaryEntry || '查看答题小结';
  for (let i = 0; i < attempts; i++) {
    await gate();
    const text = await page.locator('main').innerText();
    if (isAnswerSummary(text, {summary: summaryText})) return text;
    const summary = page.getByText(entryText, {exact: true}).filter({visible: true});
    if (await summary.count() === 1) {
      await gate(); await summary.click({timeout: 5000});
      await wait(1000);
      const result = await page.locator('main').innerText();
      if (isAnswerSummary(result, {summary: summaryText})) return result;
    }
    if (i < attempts - 1) await wait(1000);
  }
  return null;
}