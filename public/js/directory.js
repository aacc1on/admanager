// File: public/js/directory.js
(function () {
  var toggleImportBtn = document.getElementById('toggleImportBtn');
  var importPanel = document.getElementById('importPanel');
  if (toggleImportBtn) {
    toggleImportBtn.addEventListener('click', function () {
      importPanel.hidden = !importPanel.hidden;
      toggleImportBtn.textContent = importPanel.hidden ? '+ Import AD export CSV files' : '− Hide';
    });
  }

  var searchInput = document.getElementById('userSearchInput');
  var searchHint = document.getElementById('searchHint');
  var tableBody = document.getElementById('userTableBody');
  var tableEmpty = document.getElementById('userTableEmpty');
  var debounceTimer = null;

  function statusBadge(user) {
    var badge = document.createElement('span');
    badge.className = 'badge ' + (user.enabled ? 'badge-active' : 'badge-disabled');
    badge.textContent = user.enabled ? 'Enabled' : 'Disabled';
    return badge;
  }

  function renderRow(user) {
    var tr = document.createElement('tr');

    var tdAccount = document.createElement('td');
    tdAccount.textContent = user.displayName || user.samAccountName;
    tr.appendChild(tdAccount);

    var tdCompany = document.createElement('td');
    tdCompany.textContent = user.company || '—';
    tr.appendChild(tdCompany);

    var tdEmail = document.createElement('td');
    tdEmail.textContent = user.canToggle ? user.email : '—';
    tr.appendChild(tdEmail);

    var tdStatus = document.createElement('td');
    tdStatus.appendChild(statusBadge(user));
    tr.appendChild(tdStatus);

    var tdAction = document.createElement('td');
    if (user.canToggle) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary-btn';
      btn.textContent = user.enabled ? 'Disable' : 'Enable';
      btn.addEventListener('click', function () { toggleUser(user, btn, tdStatus); });
      tdAction.appendChild(btn);
    } else {
      var span = document.createElement('span');
      span.className = 'hint';
      span.textContent = 'No mailbox';
      tdAction.appendChild(span);
    }
    tr.appendChild(tdAction);

    tableBody.appendChild(tr);
  }

  function toggleUser(user, btn, tdStatus) {
    var nextEnabled = !user.enabled;
    var confirmMsg = (nextEnabled ? 'Enable ' : 'Disable ') + (user.displayName || user.samAccountName) + '?';
    if (!confirm(confirmMsg)) return;

    btn.disabled = true;
    fetch('/directory/api/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ samAccountName: user.samAccountName, mail: user.email, enabled: nextEnabled })
    })
      .then(function (r) { return r.json().then(function (data) { return { status: r.status, data: data }; }); })
      .then(function (res) {
        if (!res.data.ok) {
          alert('Failed: ' + res.data.message);
          btn.disabled = false;
          return;
        }
        user.enabled = nextEnabled;
        tdStatus.innerHTML = '';
        tdStatus.appendChild(statusBadge(user));
        btn.textContent = user.enabled ? 'Disable' : 'Enable';
        btn.disabled = false;
      })
      .catch(function () {
        alert('Request failed.');
        btn.disabled = false;
      });
  }

  function runSearch(query) {
    fetch('/directory/api/search?q=' + encodeURIComponent(query))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        tableBody.innerHTML = '';
        var users = (data && data.users) || [];
        tableEmpty.hidden = users.length > 0;
        users.forEach(renderRow);
        searchHint.textContent = users.length >= 100 ? 'Showing first 100 matches — refine your search for more precise results.' : (users.length + ' result(s).');
      })
      .catch(function () {
        tableBody.innerHTML = '<tr><td colspan="5" class="hint">Search failed.</td></tr>';
      });
  }

  searchInput.addEventListener('input', function () {
    var query = searchInput.value.trim();
    clearTimeout(debounceTimer);
    if (!query) {
      tableBody.innerHTML = '';
      tableEmpty.hidden = true;
      searchHint.textContent = 'Type at least one character to search the imported directory.';
      return;
    }
    debounceTimer = setTimeout(function () { runSearch(query); }, 250);
  });
})();
