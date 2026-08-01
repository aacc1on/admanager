// File: public/js/bulk.js
(function () {
  var form = document.getElementById('bulkForm');
  var actionSelect = document.getElementById('bulkAction');
  var emailsTextarea = document.getElementById('bulkEmails');
  var emailCountHint = document.getElementById('emailCountHint');
  var notifyEmailRow = document.getElementById('notifyEmailRow');
  var notifyEmailInput = document.getElementById('bulkNotifyEmail');
  var submitBtn = document.getElementById('bulkSubmitBtn');
  var statusWindow = document.getElementById('statusWindow');
  var statusList = document.getElementById('statusList');

  function parseEmails() {
    return emailsTextarea.value
      .split(/[\s,;]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function updateCountHint() {
    emailCountHint.textContent = parseEmails().length + ' email(s) detected';
  }

  function updateNotifyVisibility() {
    var isReset = actionSelect.value === 'reset';
    notifyEmailRow.hidden = !isReset;
    notifyEmailInput.required = isReset;
  }

  emailsTextarea.addEventListener('input', updateCountHint);
  actionSelect.addEventListener('change', updateNotifyVisibility);
  updateCountHint();
  updateNotifyVisibility();

  function addLine(text, cls) {
    var li = document.createElement('li');
    li.textContent = text;
    li.className = cls || '';
    statusList.appendChild(li);
    return li;
  }

  function handleEvent(data, stepLines) {
    if (data.step === 'done') {
      var cls = data.status === 'success' ? 'done' : (data.status === 'partial' ? 'warn' : 'error');
      addLine(data.message, cls);
      return;
    }
    var icon = '...';
    if (data.status === 'done') icon = 'OK';
    else if (data.status === 'error') icon = 'ERROR';
    else if (data.status === 'warn') icon = 'WARN';
    var text = icon + ' ' + data.message;
    if (stepLines[data.step] && data.status !== 'progress') {
      stepLines[data.step].textContent = text;
      stepLines[data.step].className = data.status;
    } else {
      stepLines[data.step] = addLine(text, data.status);
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var emails = parseEmails();
    if (!emails.length) {
      alert('Paste at least one email address.');
      return;
    }
    var action = actionSelect.value;
    if (action === 'reset' && !notifyEmailInput.value.trim()) {
      alert('Enter an address to send the password reset report to.');
      return;
    }
    if (action !== 'reset' && !confirm((action === 'enable' ? 'Enable ' : 'Disable ') + emails.length + ' account(s)?')) {
      return;
    }

    statusWindow.hidden = false;
    statusList.innerHTML = '';
    submitBtn.disabled = true;
    var stepLines = {};

    fetch('/bulk/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, emails: emails, notifyEmail: notifyEmailInput.value.trim() })
    })
      .then(function (r) {
        var reader = r.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        function pump() {
          return reader.read().then(function (res) {
            if (res.done) {
              submitBtn.disabled = false;
              return;
            }
            buffer += decoder.decode(res.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop();
            lines.forEach(function (line) {
              if (!line.trim()) return;
              handleEvent(JSON.parse(line), stepLines);
            });
            return pump();
          });
        }

        return pump();
      })
      .catch(function () {
        addLine('Connection error. Please try again.', 'error');
        submitBtn.disabled = false;
      });
  });
})();
