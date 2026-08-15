(function () {
  // Translate DSH's fixed English UI chrome (role badges, column headers,
  // status labels) in the 轨迹 (trajectory) tab to Chinese. Deliberately
  // scoped to static interface strings only — tool/function identifiers
  // (bash, job_output, todo_write, ask_user_question), mode names
  // (Workspace Write), and dynamically generated model/system-prompt
  // content are left untouched, since those are technical identifiers or
  // live content, not UI copy.
  var EXACT = {
    ASSISTANT: '助手',
    CONTEXT: '上下文',
    SYSTEM: '系统',
    TOOL: '工具',
    USER: '用户',
    Calls: '调用次数',
    Duration: '耗时',
    Turns: '轮次',
    Model: '模型',
    Tools: '工具',
    'Session log': '会话日志',
    'Initial System Prompt': '初始系统提示词',
    Input: '输入',
    Output: '输出',
    CLEANED: '已清理',

    // Slash-command descriptions in the composer's "+" menu. The command
    // NAMES (compact, export, …) stay English — those are what you type,
    // so translating them would break the thing they name. Only the
    // human-readable descriptions beside them are localized.
    'Compact older conversation history': '压缩较早的对话历史，腾出上下文空间',
    'Download this Session log as a ZIP archive': '把本次会话日志打包成 ZIP 下载',
    'record feedback about this session': '记录你对本次会话的反馈',
    'set or view the goal for a long-running task': '设定或查看长任务的目标',
    'Switch the permission preset (sandbox mode + approval policy)':
      '切换权限档位（沙箱模式 + 审批策略）',
    'Enter or leave plan mode': '进入或退出计划模式（先出方案再动手）',
  };
  var PATTERNS = [
    [/^Turn (\d+)$/, function (m) { return '第' + m[1] + '轮'; }],
    [/^started background job (\S+)$/, function (m) { return '已启动后台任务 ' + m[1]; }],
  ];

  function translateNode(node) {
    var raw = node.nodeValue;
    if (!raw) return;
    var trimmed = raw.trim();
    if (!trimmed) return;
    if (Object.prototype.hasOwnProperty.call(EXACT, trimmed)) {
      node.nodeValue = raw.replace(trimmed, EXACT[trimmed]);
      return;
    }
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = trimmed.match(PATTERNS[i][0]);
      if (m) {
        node.nodeValue = raw.replace(trimmed, PATTERNS[i][1](m));
        return;
      }
    }
  }

  function translateAll(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) translateNode(node);
  }

  translateAll(document.body);
  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (n) {
        if (n.nodeType === Node.TEXT_NODE) translateNode(n);
        else if (n.nodeType === Node.ELEMENT_NODE) translateAll(n);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
})();
