// File: public/js/groups.js
(function () {
  var groupListEl = document.getElementById('groupList');
  var groupListEmpty = document.getElementById('groupListEmpty');
  var searchInput = document.getElementById('groupSearchInput');
  var membersPanel = document.getElementById('membersPanel');
  var membersPanelHeader = document.getElementById('membersPanelHeader');
  var membersTableBody = document.getElementById('membersTableBody');
  var membersEmpty = document.getElementById('membersEmpty');

  var toggleCreateGroupBtn = document.getElementById('toggleCreateGroupBtn');
  var createGroupPanel = document.getElementById('createGroupPanel');
  var newPartnerName = document.getElementById('newPartnerName');
  var newPartnerId = document.getElementById('newPartnerId');
  var newGroupPreview = document.getElementById('newGroupPreview');
  var newGroupNameValue = document.getElementById('newGroupNameValue');
  var newGroupNamePre2000 = document.getElementById('newGroupNamePre2000');

  var allGroups = [];
  var selectedPartner = null;

  function sanitizeForAD(value) {
    if (!value) return '';
    return value.toString().replace(/[,+"\\<>;\r\n=]/g, '').trim();
  }

  function buildGroupName(partnerName, partnerId) {
    var cleanName = sanitizeForAD(partnerName).replace(/\s+/g, ' ').trim();
    var cleanId = sanitizeForAD(partnerId).toString().trim();
    return cleanName + '-RDS-' + cleanId;
  }

  function renderGroupList(filterText) {
    var text = (filterText || '').toLowerCase().trim();
    var filtered = allGroups.filter(function (g) {
      if (!text) return true;
      return (g.partner || '').toLowerCase().indexOf(text) !== -1 ||
        (g.partnerId || '').toLowerCase().indexOf(text) !== -1 ||
        (g.groupName || '').toLowerCase().indexOf(text) !== -1;
    });

    groupListEl.innerHTML = '';
    groupListEmpty.hidden = filtered.length > 0;

    filtered.forEach(function (g) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'group-list-item' + (selectedPartner === g.partner ? ' selected' : '');
      row.innerHTML =
        '<span class="group-list-name">' + g.partner + ' <span class="hint">(#' + g.partnerId + ')</span></span>' +
        '<code class="group-list-code">' + g.groupName + '</code>' +
        '<span class="hint">' + g.userCount + ' provisioned</span>';
      row.addEventListener('click', function () { selectGroup(g); });
      groupListEl.appendChild(row);
    });
  }

  function loadGroups() {
    return fetch('/groups/api/list')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        allGroups = data.groups || [];
        renderGroupList(searchInput.value);
      });
  }

  var refreshGroupsBtn = document.getElementById('refreshGroupsBtn');
  refreshGroupsBtn.addEventListener('click', function () {
    refreshGroupsBtn.disabled = true;
    refreshGroupsBtn.textContent = 'Refreshing...';
    loadGroups().finally(function () {
      refreshGroupsBtn.disabled = false;
      refreshGroupsBtn.textContent = 'Refresh';
    });
  });

  function statusCell(member) {
    var badge = document.createElement('span');
    badge.className = 'badge ' + (member.enabled ? 'badge-active' : 'badge-disabled');
    badge.textContent = member.enabled ? 'Active' : 'Disabled';
    return badge;
  }

  function selectGroup(g) {
    selectedPartner = g.partner;
    renderGroupList(searchInput.value);
    membersPanel.hidden = false;
    membersPanelHeader.textContent = 'Group members — ' + g.partner + ' (' + g.groupName + ')';
    membersTableBody.innerHTML = '<tr><td colspan="4" class="hint">Loading...</td></tr>';
    membersEmpty.hidden = true;

    fetch('/groups/api/members?partner=' + encodeURIComponent(g.partner))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        membersTableBody.innerHTML = '';
        if (!data.ok) {
          membersTableBody.innerHTML = '<tr><td colspan="4" class="hint">' + data.message + '</td></tr>';
          return;
        }
        if (!data.members.length) {
          membersEmpty.hidden = false;
          return;
        }
        data.members.forEach(function (member) { renderMemberRow(member); });
      })
      .catch(function () {
        membersTableBody.innerHTML = '<tr><td colspan="4" class="hint">Failed to load members.</td></tr>';
      });
  }

  function renderMemberRow(member) {
    var tr = document.createElement('tr');

    var tdAccount = document.createElement('td');
    tdAccount.textContent = member.samAccountName;
    tr.appendChild(tdAccount);

    var tdEmail = document.createElement('td');
    tdEmail.textContent = member.email;
    tr.appendChild(tdEmail);

    var tdStatus = document.createElement('td');
    tdStatus.appendChild(statusCell(member));
    tr.appendChild(tdStatus);

    var tdAction = document.createElement('td');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary-btn';
    btn.textContent = member.enabled ? 'Disable' : 'Enable';
    btn.addEventListener('click', function () { toggleMember(member, btn, tdStatus); });
    tdAction.appendChild(btn);
    tr.appendChild(tdAction);

    membersTableBody.appendChild(tr);
  }

  function toggleMember(member, btn, tdStatus) {
    var nextEnabled = !member.enabled;
    var confirmMsg = (nextEnabled ? 'Enable ' : 'Disable ') + member.samAccountName + '?';
    if (!confirm(confirmMsg)) return;

    btn.disabled = true;
    fetch('/groups/api/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mail: member.email, enabled: nextEnabled })
    })
      .then(function (r) { return r.json().then(function (data) { return { status: r.status, data: data }; }); })
      .then(function (res) {
        if (!res.data.ok) {
          alert('Failed: ' + res.data.message);
          btn.disabled = false;
          return;
        }
        member.enabled = nextEnabled;
        tdStatus.innerHTML = '';
        tdStatus.appendChild(statusCell(member));
        btn.textContent = member.enabled ? 'Disable' : 'Enable';
        btn.disabled = false;
      })
      .catch(function () {
        alert('Request failed.');
        btn.disabled = false;
      });
  }

  function updateCreatePreview() {
    var name = newPartnerName.value.trim();
    var id = newPartnerId.value.trim();
    if (!name || !id) {
      newGroupPreview.hidden = true;
      return;
    }
    var groupName = buildGroupName(name, id);
    newGroupNameValue.textContent = groupName;
    newGroupNamePre2000.textContent = groupName.length > 20 ? groupName.slice(0, 20) : groupName;
    newGroupPreview.hidden = false;
  }

  searchInput.addEventListener('input', function () { renderGroupList(searchInput.value); });
  newPartnerName.addEventListener('input', updateCreatePreview);
  newPartnerId.addEventListener('input', updateCreatePreview);
  toggleCreateGroupBtn.addEventListener('click', function () {
    createGroupPanel.hidden = !createGroupPanel.hidden;
    toggleCreateGroupBtn.textContent = createGroupPanel.hidden ? '+ Create a new group' : '− Hide';
  });

  loadGroups();
})();
