// File: public/js/reset-password.js
document.getElementById('resetForm').addEventListener('submit', function (e) {
  e.preventDefault();

  var form = e.target;
  var submitBtn = document.getElementById('resetSubmitBtn');
  var statusWindow = document.getElementById('statusWindow');
  var statusList = document.getElementById('statusList');
  statusWindow.hidden = false;
  statusList.innerHTML = '';
  submitBtn.disabled = true;

  var params = new URLSearchParams(new FormData(form));
  var source = new EventSource('/reset-password/stream?' + params.toString());
  var stepLines = {};

  function addLine(text, cls) {
    var li = document.createElement('li');
    li.textContent = text;
    li.className = cls || '';
    statusList.appendChild(li);
    return li;
  }

  source.onmessage = function (event) {
    var data = JSON.parse(event.data);
    if (data.step === 'credentials') {
      var box = document.createElement('li');
      box.className = 'credentials-box';
      box.innerHTML =
        '<strong>Send this password manually (copy now, it will not be shown again)</strong>' +
        '<div>Send to: <code>' + data.notifyEmail + '</code></div>' +
        '<div>Account email: <code>' + data.accountEmail + '</code></div>' +
        '<div>Password: <code>' + data.password + '</code></div>';
      statusList.appendChild(box);
      return;
    }
    if (data.step === 'done') {
      source.close();
      submitBtn.disabled = false;
      var cls = data.status === 'success' ? 'done' : (data.status === 'partial' ? 'warn' : 'error');
      addLine(data.message, cls);
      if (data.status === 'success') {
        form.reset();
      }
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
  };

  source.onerror = function () {
    addLine('Connection error. Please try again.', 'error');
    submitBtn.disabled = false;
    source.close();
  };
});
