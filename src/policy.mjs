export class DeepSeekReplyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DeepSeekReplyError';
    this.code = 'DEEPSEEK_REPLY_FAILED';
    this.details = details;
  }
}

export function runnerPolicy(config = {}, argv = []) {
  const supplied = config.runnerPolicy || {};
  const policy = {
    skippedTasks: supplied.skippedTasks ?? 'retry',
    listeningChoices: supplied.listeningChoices ?? 'manual',
    deepseekFailure: supplied.deepseekFailure ?? 'stop',
    // taskFailure：单个任务出现异常时是否继续下一个任务（默认 continue，避免一题报错中断整轮）。
    taskFailure: supplied.taskFailure ?? 'continue',
    retrySkipped: argv.includes('--retry-skipped'),
  };
  for (const [key, allowed] of Object.entries({
    skippedTasks: ['retry', 'remember'],
    listeningChoices: ['deepseek', 'first', 'manual'],
    deepseekFailure: ['stop', 'continue'],
    taskFailure: ['stop', 'continue'],
  })) {
    if (!allowed.includes(policy[key])) throw new Error(`runnerPolicy.${key} 必须为 ${allowed.join(' / ')}`);
  }
  return policy;
}

export function shouldSkipRecord(entry, policy) {
  if (['submitted', 'learned'].includes(entry?.status)) return true;
  return entry?.status === 'skipped' && policy.skippedTasks === 'remember' && !policy.retrySkipped;
}

export function canContinueReplyFailure(error, policy) {
  return error instanceof DeepSeekReplyError && policy.deepseekFailure === 'continue';
}
