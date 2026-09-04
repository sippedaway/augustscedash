let CurrentStationId = null;
let CurrentFullConfig = {};
let CurrentStationConfig = {};
let CurrentStationConfigKeys = [];
let ActiveWhitelistKey = null;
let PendingRequests = 0;
let WeeklySelectorState = { type: 'race', district: 'pink-draft', weeklyId: null };

const NativeFetch = window.fetch.bind(window);
window.fetch = async (...Arguments) => {
    const Response = await NativeFetch(...Arguments);
    if (Response.status === 401 && !window.location.pathname.endsWith('/setup.html')) {
        window.location.href = '/setup.html';
    }
    return Response;
};

const SettingsGroups = [
    {
        title: 'Player',
        defaultOpen: true,
        items: [
            { label: 'Boost', key: 'config.player.enableThrusters', type: 'boolean', default: true },
            { label: 'Heartballs', key: 'config.player.enableHeartBall', type: 'boolean', default: true }
        ]
    },
    {
        title: 'Locked spaces',
        items: [
            { label: "Circuit Lounge", key: 'config.gateKeeperVolumes.circuitLoungeLocked', type: 'boolean', default: false },
            { label: 'Driftplex', key: 'config.gateKeeperVolumes.driftplexLocked', type: 'boolean', default: false },
            { label: 'Fieldhouse', key: 'config.gateKeeperVolumes.complexLocked', type: 'boolean', default: false },
            { label: "Dave's Office", key: 'config.gateKeeperVolumes.officeLocked', type: 'boolean', default: false }
        ]
    },
    {
        title: 'Station',
        items: [
            { label: 'Is whitelist', key: 'is_whitelist', type: 'boolean', default: true, confirmFalse: true },
            { label: 'Default Spawn', key: 'config.spawnPointSettings.overrideSpawnPoint', type: 'spawn', default: false }
        ]
    },
    {
        title: 'Teams',
        items: [
            { label: 'Tackle everyone', key: 'config.player.tackleEnemyTeamOnly', type: 'boolean', default: true, invert: true },
            { label: 'Grab enemies', key: 'config.player.enableEnemyPlayerGrab', type: 'boolean', default: true }
        ]
    }
];

const Gamemodes = {
    Tag: {
        label: "Tag",
        key: "CustomGamemodes.PKR_Scrapun_Demo_Full_1",
        value: "1;c;g;56B5F3A64A09731204A13091CD772E43;;^1.0.0",
        reqKey: "loadedgamemodes.PKR_Scrapun_Demo_Full_1.modulestate.dashboardconfigoverrides.Assistants",
        reqVal: ""
    },
    Koth: {
        label: "King of the Hill",
        key: "CustomGamemodes.0800_Full_1",
        value: "1;c;g;7C812A104B7FCD4F949A0BAA79C146F2;;Community_Map_1_KoTH"
    },
    Sm: {
        label: "Sharks and Minnows",
        key: "CustomGamemodes.0800_Full_1",
        value: "1;c;g;14C540EC4ABE82AEB55F58881FB13C04;;^0.1.4",
        reqKey: "loadedgamemodes.0800_Full_1.modulestate.dashboardconfigoverrides.Admins",
        reqVal: "higuysimaugust"
    }
};

function SetRequestState(IsLoading) {
    let Topbar = document.querySelector('.topbar');
    if (Topbar) Topbar.classList.toggle('is-loading', IsLoading);
}

function BeginRequest() {
    PendingRequests += 1;
    SetRequestState(true);
}

function EndRequest() {
    PendingRequests = Math.max(0, PendingRequests - 1);
    if (PendingRequests > 0) return;
    SetRequestState(false);
}

async function Init() {
    BeginRequest();
    try {
        var AuthRes = await fetch('/api/me');
        if (!AuthRes.ok) {
            window.location.href = '/setup.html';
            return;
        }
        let AuthData = await AuthRes.json();
        let AccountName = document.getElementById('account-name');
        let AccountAvatar = document.getElementById('account-avatar');
        let AccountAvatarFallback = document.querySelector('.account-avatar-fallback');
        AccountName.textContent = AuthData.username || 'Discord user';
        if (AuthData.id && AuthData.avatar) {
            AccountAvatar.src = `https://cdn.discordapp.com/avatars/${encodeURIComponent(AuthData.id)}/${encodeURIComponent(AuthData.avatar)}.png?size=64`;
            AccountAvatar.alt = `${AuthData.username || 'Discord user'} avatar`;
            AccountAvatar.addEventListener('error', () => {
                AccountAvatar.classList.add('hidden');
                AccountAvatarFallback.classList.remove('hidden');
            }, { once: true });
            AccountAvatar.classList.remove('hidden');
            AccountAvatarFallback.classList.add('hidden');
        }
        var Res = await fetch('/api/stations');
        var Data = await Res.json();

        if (!Res.ok) throw new Error(Data.error || 'Failed to fetch stations');
        
        if (!Data.stations) return;

        var OnlineStations = Data.stations.filter(S => S.online);
        if (OnlineStations.length === 0) return;

        var MaxVersion = Math.max(...OnlineStations.map(S => parseInt(S.version)));
        var TargetStations = OnlineStations.filter(S => parseInt(S.version) === MaxVersion);

        var Container = document.getElementById('station-list');
        Container.innerHTML = '';

        TargetStations.forEach(Station => {
            var Card = document.createElement('div');
            Card.className = 'card';
            var StationTitle = document.createElement('h3');
            StationTitle.textContent = Station.station_name;
            var RegionBadge = document.createElement('span');
            RegionBadge.className = 'badge';
            RegionBadge.style.marginTop = '10px';
            RegionBadge.style.display = 'inline-block';
            RegionBadge.textContent = Station.region;
            var PlayersBadge = document.createElement('span');
            PlayersBadge.className = 'badge';
            PlayersBadge.style.marginTop = '10px';
            PlayersBadge.style.display = 'inline-block';
            PlayersBadge.style.marginLeft = '10px';
            PlayersBadge.textContent = `${Station.player_count} players`;
            Card.append(StationTitle, RegionBadge, PlayersBadge);
            Card.onclick = () => SelectStation(Station.station_id, Station.station_name, Station.region);
            Container.appendChild(Card);
        });
    } finally {
        EndRequest();
    }
}

let SearchTimeout;
let AllFleetRoles = [];

async function FetchFleetRoles() {
    if (AllFleetRoles.length > 0) return;
    try {
        let Res = await fetch('/api/roles');
        let Data = await Res.json();
        if (Data.roles) {
            AllFleetRoles = Data.roles;
        }
    } catch (E) {}
}

let CustomGroups = [];
let PendingGroupPlayers = [];
let GroupSearchTimeout;
const Delay = Ms => new Promise(R => setTimeout(R, Ms));

async function LoadGroups() {
    RenderGroupSkeletons();
    try {
        let Res = await fetch('/api/groups');
        let Data = await Res.json();
        CustomGroups = Data.map(G => ({ id: G.id, label: G.name, players: G.players }));
    } catch(E) {
        CustomGroups = [];
    }
    RenderGroupsPanel();
}

function RenderGroupSkeletons() {
    let Container = document.getElementById('custom-groups-container');
    if (!Container) return;

    Container.innerHTML = Array.from({ length: 3 }, () => `
        <div class="custom-group-card group-skeleton" aria-hidden="true">
            <span class="group-skeleton-title"></span>
            <span class="group-skeleton-players"></span>
            <span class="group-skeleton-actions"></span>
        </div>
    `).join('');
}

function RenderGroupsPanel() {
    let Container = document.getElementById('custom-groups-container');
    if (!Container) return;
    Container.innerHTML = '';
    
    CustomGroups.forEach(Group => {
        let Card = document.createElement('div');
        Card.className = 'custom-group-card';
        
        let Title = document.createElement('div');
        Title.className = 'custom-group-title';
        let GroupIcon = document.createElement('i');
        GroupIcon.className = 'fas fa-users';
        GroupIcon.style.marginRight = '6px';
        let CountSpan = document.createElement('span');
        CountSpan.style.opacity = '0.6';
        CountSpan.style.marginLeft = '8px';
        CountSpan.style.fontSize = '0.85em';
        CountSpan.textContent = `(${Group.players.length})`;

        Title.append(GroupIcon, document.createTextNode(Group.label), CountSpan);
        Card.appendChild(Title);

        let PlayersDiv = document.createElement('div');
        Group.players.forEach(P => {
            let Badge = document.createElement('span');
            Badge.className = 'group-player-badge';
            Badge.textContent = P.username;
            PlayersDiv.appendChild(Badge);
        });
        
        let BtnContainer = document.createElement('div');
        BtnContainer.style.cssText = 'display: flex; gap: 0.5rem; margin-top: 0.5rem;';

        let EditBtn = document.createElement('button');
        EditBtn.className = 'button-secondary';
        EditBtn.style.cssText = 'font-size: 0.7rem; padding: 0.2rem 0.4rem;';
        EditBtn.textContent = 'Edit Group';
        EditBtn.onclick = () => OpenEditGroupModal(Group);
        
        let DelBtn = document.createElement('button');
        DelBtn.className = 'button-secondary';
        DelBtn.style.cssText = 'font-size: 0.7rem; padding: 0.2rem 0.4rem;';
        DelBtn.textContent = 'Delete Group';
        DelBtn.onclick = () => ConfirmDeleteGroup(Group.id);

        BtnContainer.appendChild(EditBtn);
        BtnContainer.appendChild(DelBtn);

        Card.appendChild(PlayersDiv);
        Card.appendChild(BtnContainer);
        Container.appendChild(Card);
    });
}

async function SaveNewGroup() {
    let Name = document.getElementById('new-group-name').value.trim();
    if (!Name || PendingGroupPlayers.length === 0) return;
    BeginRequest();
    try {
        await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: Name, players: PendingGroupPlayers })
        });
        await LoadGroups();
        CloseCreateGroupModal();
    } finally {
        EndRequest();
    }
}

function OpenCreateGroupModal() {
    PendingGroupPlayers = [];
    document.getElementById('new-group-name').value = '';
    document.getElementById('group-player-search').value = '';
    document.getElementById('group-player-search-results').classList.add('hidden');
    RenderPendingGroupPlayers();
    document.getElementById('create-group-modal').classList.add('active');
}

function CloseCreateGroupModal() {
    document.getElementById('create-group-modal').classList.remove('active');
}

function HandleCreateGroupBackdropClick(Event) {
    if (Event.target && Event.target.id === 'create-group-modal') {
        CloseCreateGroupModal();
    }
}

function RenderPendingGroupPlayers() {
    let Container = document.getElementById('pending-group-players');
    Container.innerHTML = '';
    PendingGroupPlayers.forEach(P => {
        let Tag = document.createElement('div');
        Tag.className = 'role-tag';
        let Username = document.createElement('span');
        Username.textContent = P.username;
        let RemoveButton = document.createElement('button');
        RemoveButton.className = 'role-remove';
        RemoveButton.textContent = '\u00d7';
        RemoveButton.onclick = () => RemovePendingGroupPlayer(P.id);
        Tag.append(Username, RemoveButton);
        Container.appendChild(Tag);
    });
}

function RemovePendingGroupPlayer(Id) {
    PendingGroupPlayers = PendingGroupPlayers.filter(P => P.id !== Id);
    RenderPendingGroupPlayers();
}

function AddPendingGroupPlayer(Id, Username) {
    if (!PendingGroupPlayers.find(P => P.id === Id)) {
        PendingGroupPlayers.push({ id: Id, username: Username });
        RenderPendingGroupPlayers();
    }
    document.getElementById('group-player-search-results').classList.add('hidden');
    document.getElementById('group-player-search').value = '';
}

let EditingGroupId = null;
let GroupToDelete = null;

function OpenEditGroupModal(Group) {
    EditingGroupId = Group.id;
    PendingGroupPlayers = [...Group.players];
    document.getElementById('edit-group-name').value = Group.label;
    document.getElementById('edit-group-player-search').value = '';
    document.getElementById('edit-group-player-search-results').classList.add('hidden');
    RenderEditGroupPlayers();
    document.getElementById('edit-group-modal').classList.add('active');
}

function CloseEditGroupModal() {
    document.getElementById('edit-group-modal').classList.remove('active');
    EditingGroupId = null;
}

function HandleEditGroupBackdropClick(Event) {
    if (Event.target && Event.target.id === 'edit-group-modal') {
        CloseEditGroupModal();
    }
}

function RenderEditGroupPlayers() {
    let Container = document.getElementById('edit-group-players');
    Container.innerHTML = '';
    PendingGroupPlayers.forEach(P => {
        let Tag = document.createElement('div');
        Tag.className = 'role-tag';
        let Username = document.createElement('span');
        Username.textContent = P.username;
        let RemoveButton = document.createElement('button');
        RemoveButton.className = 'role-remove';
        RemoveButton.textContent = '\u00d7';
        RemoveButton.onclick = () => RemoveEditGroupPlayer(P.id);
        Tag.append(Username, RemoveButton);
        Container.appendChild(Tag);
    });
}

function RemoveEditGroupPlayer(Id) {
    PendingGroupPlayers = PendingGroupPlayers.filter(P => P.id !== Id);
    RenderEditGroupPlayers();
}

function AddEditGroupPlayer(Id, Username) {
    if (!PendingGroupPlayers.find(P => P.id === Id)) {
        PendingGroupPlayers.push({ id: Id, username: Username });
        RenderEditGroupPlayers();
    }
    document.getElementById('edit-group-player-search-results').classList.add('hidden');
    document.getElementById('edit-group-player-search').value = '';
}

async function SaveEditedGroup() {
    let Name = document.getElementById('edit-group-name').value.trim();
    if (!Name || PendingGroupPlayers.length === 0 || !EditingGroupId) return;
    BeginRequest();
    try {
        await fetch(`/api/groups/${EditingGroupId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: Name, players: PendingGroupPlayers })
        });
        await LoadGroups();
        CloseEditGroupModal();
    } finally {
        EndRequest();
    }
}

function ConfirmDeleteGroup(Id) {
    GroupToDelete = Id;
    document.getElementById('delete-group-modal').classList.add('active');
}

function CloseDeleteGroupModal() {
    document.getElementById('delete-group-modal').classList.remove('active');
    GroupToDelete = null;
}

function HandleDeleteGroupBackdropClick(Event) {
    if (Event.target && Event.target.id === 'delete-group-modal') {
        CloseDeleteGroupModal();
    }
}

async function ExecuteDeleteGroup() {
    if (!GroupToDelete) return;
    BeginRequest();
    try {
        await fetch(`/api/groups/${GroupToDelete}`, { method: 'DELETE' });
        await LoadGroups();
        CloseDeleteGroupModal();
    } finally {
        EndRequest();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    LoadGroups();
    SetMainTab('stations');

    document.querySelectorAll('.page-tab').forEach((TabButton) => {
        TabButton.addEventListener('click', () => SetMainTab(TabButton.dataset.tab));
    });
    
    let SearchInput = document.getElementById('player-search-input');
    if (SearchInput) {
        SearchInput.addEventListener('input', function(E) {
            clearTimeout(SearchTimeout);
            let Query = E.target.value.trim();
            let ResultsContainer = document.getElementById('player-search-results');
            
            if (Query.length === 0) {
                ResultsContainer.classList.add('hidden');
                return;
            }

            let GroupMatches = CustomGroups.filter(G => G.label.toLowerCase().includes(Query.toLowerCase()));

            SearchTimeout = setTimeout(async () => {
                BeginRequest();
                try {
                    let Res = await fetch('/api/players/search?q=' + encodeURIComponent(Query));
                    let Data = await Res.json();
                    
                    ResultsContainer.innerHTML = '';

                    GroupMatches.forEach(G => {
                        let Div = document.createElement('div');
                        Div.className = 'search-result-item';
                        let GroupIcon = document.createElement('i');
                        GroupIcon.className = 'fas fa-users';
                        GroupIcon.style.color = 'var(--primary)';
                        GroupIcon.style.marginRight = '8px';
                        Div.append(GroupIcon, document.createTextNode(G.label));
                        Div.onclick = () => SelectGroup(G);
                        ResultsContainer.appendChild(Div);
                    });
                    
                    if (Data.items && Data.items.length > 0) {
                        Data.items.forEach(Player => {
                            let Div = document.createElement('div');
                            Div.className = 'search-result-item';
                            Div.textContent = Player.username;
                            Div.onclick = () => SelectPlayer(Player.user_id, Player.username);
                            ResultsContainer.appendChild(Div);
                        });
                    } else if (GroupMatches.length === 0) {
                        let Div = document.createElement('div');
                        Div.className = 'search-result-item';
                        Div.textContent = 'No results found...';
                        ResultsContainer.appendChild(Div);
                    }
                    ResultsContainer.classList.remove('hidden');
                } finally {
                    EndRequest();
                }
            }, 500);
        });
    }
    
    let GroupSearchInput = document.getElementById('group-player-search');
    if (GroupSearchInput) {
        GroupSearchInput.addEventListener('input', function(E) {
            clearTimeout(GroupSearchTimeout);
            let Query = E.target.value.trim();
            let ResultsContainer = document.getElementById('group-player-search-results');
            
            if (Query.length === 0) {
                ResultsContainer.classList.add('hidden');
                return;
            }

            GroupSearchTimeout = setTimeout(async () => {
                let Res = await fetch('/api/players/search?q=' + encodeURIComponent(Query));
                let Data = await Res.json();
                
                ResultsContainer.innerHTML = '';
                if (Data.items && Data.items.length > 0) {
                    Data.items.forEach(Player => {
                        let Div = document.createElement('div');
                        Div.className = 'search-result-item';
                        Div.textContent = Player.username;
                        Div.onclick = () => AddPendingGroupPlayer(Player.user_id, Player.username);
                        ResultsContainer.appendChild(Div);
                    });
                } else {
                    let Div = document.createElement('div');
                    Div.className = 'search-result-item';
                    Div.textContent = 'No results found...';
                    ResultsContainer.appendChild(Div);
                }
                ResultsContainer.classList.remove('hidden');
            }, 500);
        });
    }

    let EditGroupSearchInput = document.getElementById('edit-group-player-search');
    if (EditGroupSearchInput) {
        EditGroupSearchInput.addEventListener('input', function(E) {
            clearTimeout(GroupSearchTimeout);
            let Query = E.target.value.trim();
            let ResultsContainer = document.getElementById('edit-group-player-search-results');
            
            if (Query.length === 0) {
                ResultsContainer.classList.add('hidden');
                return;
            }

            GroupSearchTimeout = setTimeout(async () => {
                let Res = await fetch('/api/players/search?q=' + encodeURIComponent(Query));
                let Data = await Res.json();
                
                ResultsContainer.innerHTML = '';
                if (Data.items && Data.items.length > 0) {
                    Data.items.forEach(Player => {
                        let Div = document.createElement('div');
                        Div.className = 'search-result-item';
                        Div.textContent = Player.username;
                        Div.onclick = () => AddEditGroupPlayer(Player.user_id, Player.username);
                        ResultsContainer.appendChild(Div);
                    });
                } else {
                    let Div = document.createElement('div');
                    Div.className = 'search-result-item';
                    Div.textContent = 'No results found...';
                    ResultsContainer.appendChild(Div);
                }
                ResultsContainer.classList.remove('hidden');
            }, 500);
        });
    }

    FetchFleetRoles();

    let RoleSearchInput = document.getElementById('role-search-input');
    if (RoleSearchInput) {
        RoleSearchInput.addEventListener('input', Event => RenderAvailableRoles(Event.target.value));
    }
});

let ActiveRoleTargets = [];

async function SelectPlayer(Id, Username) {
    ActiveRoleTargets = [{ id: Id, username: Username }];
    document.getElementById('player-search-results').classList.add('hidden');
    document.getElementById('player-search-input').value = '';
    document.getElementById('selected-player-name').textContent = Username;
    document.getElementById('selected-player-container').classList.remove('hidden');
    await LoadPlayerRoles();
}

async function SelectGroup(Group) {
    ActiveRoleTargets = [...Group.players];
    document.getElementById('player-search-results').classList.add('hidden');
    document.getElementById('player-search-input').value = '';
    document.getElementById('selected-player-name').textContent = Group.label + " (Group)";
    document.getElementById('selected-player-container').classList.remove('hidden');
    await LoadPlayerRoles();
}

async function LoadPlayerRoles() {
    if (ActiveRoleTargets.length === 0) return;
    BeginRequest();
    try {
        let RoleMap = new Map();
        for (let Target of ActiveRoleTargets) {
            let Res = await fetch(`/api/players/${Target.id}/roles`);
            let Data = await Res.json();
            if (Data.roles) {
                Data.roles.forEach(R => {
                    if (!RoleMap.has(R.role_id)) RoleMap.set(R.role_id, R);
                });
            }
            await Delay(200);
        }
        
        let Container = document.getElementById('player-roles-container');
        Container.innerHTML = '';
        
        if (RoleMap.size > 0) {
            RoleMap.forEach(Role => {
                let Tag = document.createElement('div');
                Tag.className = 'role-tag';
                
                let NameSpan = document.createElement('span');
                NameSpan.textContent = Role.role_name;
                
                let RemoveBtn = document.createElement('button');
                RemoveBtn.className = 'role-remove';
                RemoveBtn.innerHTML = '&times;';
                RemoveBtn.onclick = function(E) {
                    E.stopPropagation();
                    if (confirm('Remove role ' + Role.role_name + ' from all selected?')) {
                        RemovePlayerRole(Role.role_id);
                    }
                };

                let Tooltip = document.createElement('div');
                Tooltip.className = 'tooltip-text';
                let Permissions = Array.isArray(Role.permissions) ? Role.permissions : [];
                let VisiblePermissions = Permissions.slice(0, 5);
                if (Permissions.length > 5) {
                    VisiblePermissions.push('+' + (Permissions.length - 5) + ' more...');
                }
                Tooltip.textContent = VisiblePermissions.join('\n') || 'No permissions assigned.';
                
                Tag.appendChild(NameSpan);
                Tag.appendChild(RemoveBtn);
                Tag.appendChild(Tooltip);
                Container.appendChild(Tag);
            });
        } else {
            Container.textContent = 'No roles assigned.';
        }
    } finally {
        EndRequest();
    }
}

function OpenAddRoleModal() {
    let SearchInput = document.getElementById('role-search-input');
    SearchInput.value = '';
    RenderAvailableRoles();
    document.getElementById('add-role-modal').classList.add('active');
    SearchInput.focus();
}

function RenderAvailableRoles(Query = '') {
    let Container = document.getElementById('available-roles-container');
    let NormalizedQuery = Query.trim().toLowerCase();
    let MatchingRoles = AllFleetRoles.filter(Role => {
        if (!NormalizedQuery) return true;
        let RoleName = String(Role.role_name || '').toLowerCase();
        let Permissions = Array.isArray(Role.permissions) ? Role.permissions : [];
        return RoleName.includes(NormalizedQuery) || Permissions.some(Permission => String(Permission).toLowerCase().includes(NormalizedQuery));
    });
    Container.innerHTML = '';
    
    MatchingRoles.forEach(Role => {
        let Div = document.createElement('div');
        Div.className = 'role-option';
        let RoleName = document.createElement('strong');
        RoleName.textContent = Role.role_name;
        Div.appendChild(RoleName);

        let Permissions = document.createElement('ul');
        Permissions.className = 'role-permissions';
        let RolePermissions = Array.isArray(Role.permissions) ? Role.permissions : [];
        if (RolePermissions.length === 0) {
            let Permission = document.createElement('li');
            Permission.textContent = 'No permissions assigned.';
            Permissions.appendChild(Permission);
        } else {
            RolePermissions.forEach(PermissionName => {
                let Permission = document.createElement('li');
                Permission.textContent = PermissionName;
                Permissions.appendChild(Permission);
            });
        }
        Div.appendChild(Permissions);
        Div.onclick = () => AddPlayerRole(Role.role_id);
        Container.appendChild(Div);
    });

    if (MatchingRoles.length === 0) {
        let EmptyState = document.createElement('p');
        EmptyState.className = 'role-empty';
        EmptyState.textContent = 'No matching roles found.';
        Container.appendChild(EmptyState);
    }
}

function CloseAddRoleModal() {
    document.getElementById('add-role-modal').classList.remove('active');
}

function HandleRoleModalBackdropClick(Event) {
    if (Event.target && Event.target.id === 'add-role-modal') {
        CloseAddRoleModal();
    }
}

async function FetchWithRetry(Url, Options = {}, MaxRetries = 3) {
    for (let Attempt = 0; Attempt < MaxRetries; Attempt++) {
        let Res = await fetch(Url, Options);
        
        if (Res.status === 429) {
            let RetryAfter = Res.headers.get('Retry-After');
            let WaitTime = RetryAfter ? parseInt(RetryAfter, 10) * 1000 : (1000 * Math.pow(2, Attempt));
            await Delay(WaitTime);
            continue;
        }
        
        return Res;
    }
    return fetch(Url, Options);
}

async function RemovePlayerRole(RoleId) {
    BeginRequest();
    
    let Container = document.getElementById('player-roles-container');
    let ProgressNode = document.createElement('div');
    ProgressNode.style.cssText = 'margin-bottom: 1rem; font-weight: bold; color: var(--primary);';
    Container.prepend(ProgressNode);

    try {
        let errors = [];
        for (let i = 0; i < ActiveRoleTargets.length; i++) {
            let Target = ActiveRoleTargets[i];
            ProgressNode.textContent = `Removing role: ${i + 1} / ${ActiveRoleTargets.length} (${Target.username})`;
            
            let Res = await FetchWithRetry(`/api/players/${Target.id}/roles/${RoleId}`, { method: 'DELETE' });
            
            if (!Res.ok) {
                let ErrorData = await Res.json().catch(() => ({}));
                errors.push(`${Target.username}: ${ErrorData.error || 'Failed to remove role'}`);
            }
            await Delay(300);
        }
        
        if (errors.length > 0) {
            alert('Error removing role:\n\n' + errors.join('\n'));
        }
        
        await LoadPlayerRoles();
    } finally {
        EndRequest();
    }
}

async function AddPlayerRole(RoleId) {
    CloseAddRoleModal();
    BeginRequest();
    
    let Container = document.getElementById('player-roles-container');
    let ProgressNode = document.createElement('div');
    ProgressNode.style.cssText = 'margin-bottom: 1rem; font-weight: bold; color: var(--primary);';
    Container.prepend(ProgressNode);

    try {
        let errors = [];
        for (let i = 0; i < ActiveRoleTargets.length; i++) {
            let Target = ActiveRoleTargets[i];
            ProgressNode.textContent = `Assigning role: ${i + 1} / ${ActiveRoleTargets.length} (${Target.username})`;
            
            let Res = await FetchWithRetry(`/api/players/${Target.id}/roles/${RoleId}`, { method: 'POST' });
            
            if (!Res.ok) {
                let ErrorData = await Res.json().catch(() => ({}));
                errors.push(`${Target.username}: ${ErrorData.error || 'Failed to assign role'}`);
            }
            await Delay(300);
        }
        
        if (errors.length > 0) {
            alert('Error assigning role:\n\n' + errors.join('\n'));
        }
        
        await LoadPlayerRoles();
    } finally {
        EndRequest();
    }
}

async function SelectStation(Id, Name, Region) {
    CurrentStationId = Id;
    document.getElementById('station-name-display').textContent = Name;
    document.getElementById('station-region-display').textContent = Region;
    SetMainTab('stations');
    
    await RefreshConfig();
}

function SetMainTab(TabName) {
    const StationView = document.getElementById('view-stations');
    const StationDetailView = document.getElementById('view-station');
    const GroupsView = document.getElementById('view-groups');
    const ServerView = document.getElementById('view-server');

    document.querySelectorAll('.page-tab').forEach((TabButton) => {
        const IsActive = TabButton.dataset.tab === TabName;
        TabButton.classList.toggle('active', IsActive);
        TabButton.setAttribute('aria-selected', String(IsActive));
        TabButton.tabIndex = IsActive ? 0 : -1;
    });

    if (StationView) {
        StationView.classList.toggle('active', TabName === 'stations' && !CurrentStationId);
        StationView.classList.remove('groups-only');
    }

    if (StationDetailView) {
        StationDetailView.classList.toggle('active', TabName === 'stations' && Boolean(CurrentStationId));
    }

    if (GroupsView) {
        GroupsView.classList.toggle('active', TabName === 'groups');
    }

    if (ServerView) {
        ServerView.classList.toggle('active', TabName === 'server');
    }
}

function ShowStations() {
    CurrentStationId = null;
    SetMainTab('stations');
}

function InitializeLayoutDivider() {
    let ContentGrid = document.querySelector('.content-grid');
    let Divider = document.getElementById('layout-divider');
    if (!ContentGrid || !Divider) return;

    let IsDragging = false;

    let ResetLayoutForViewport = () => {
        if (window.innerWidth <= 800) {
            ContentGrid.style.removeProperty('grid-template-columns');
            ContentGrid.classList.remove('is-resizing');
            document.body.classList.remove('is-resizing-layout');
        }
    };

    let SetLeftWidth = ClientX => {
        let Bounds = ContentGrid.getBoundingClientRect();
        let DividerTrackWidth = 32;
        let MinimumLeft = 320;
        let MinimumRight = 280;
        let MaximumLeft = Bounds.width - DividerTrackWidth - MinimumRight;
        let LeftWidth = Math.max(MinimumLeft, Math.min(ClientX - Bounds.left, MaximumLeft));
        let Percentage = Math.round((LeftWidth / Bounds.width) * 100);

        ContentGrid.classList.add('is-resizing');
        ContentGrid.style.gridTemplateColumns = `${LeftWidth}px ${DividerTrackWidth}px minmax(${MinimumRight}px, 1fr)`;
        Divider.setAttribute('aria-valuenow', String(Percentage));
    };

    Divider.addEventListener('pointerdown', Event => {
        if (window.innerWidth <= 800) return;
        IsDragging = true;
        Divider.setPointerCapture(Event.pointerId);
        document.body.classList.add('is-resizing-layout');
    });

    Divider.addEventListener('pointermove', Event => {
        if (IsDragging) SetLeftWidth(Event.clientX);
    });

    let StopDragging = Event => {
        if (!IsDragging) return;
        IsDragging = false;
        if (Event.pointerId !== undefined && Divider.hasPointerCapture(Event.pointerId)) {
            Divider.releasePointerCapture(Event.pointerId);
        }
        ContentGrid.classList.remove('is-resizing');
        document.body.classList.remove('is-resizing-layout');
    };

    Divider.addEventListener('pointerup', StopDragging);
    Divider.addEventListener('pointercancel', StopDragging);
    Divider.addEventListener('keydown', Event => {
        if (window.innerWidth <= 800) return;
        let Bounds = ContentGrid.getBoundingClientRect();
        let CurrentLeft = ContentGrid.querySelector('.controls-panel').getBoundingClientRect().width;
        let Step = Event.shiftKey ? 50 : 20;

        if (Event.key === 'ArrowLeft') {
            Event.preventDefault();
            SetLeftWidth(Bounds.left + CurrentLeft - Step);
        } else if (Event.key === 'ArrowRight') {
            Event.preventDefault();
            SetLeftWidth(Bounds.left + CurrentLeft + Step);
        }
    });

    window.addEventListener('resize', ResetLayoutForViewport);
    ResetLayoutForViewport();
}

async function RefreshConfig() {
    BeginRequest();
    try {
        let Res = await fetch(`/api/stations/${CurrentStationId}/config`);
        let Data = await Res.json();

        CurrentFullConfig = Data.fullConfig;
        CurrentStationConfig = Data.stationConfig;
        CurrentStationConfigKeys = Object.keys(Data.stationConfig);

        RenderRawConfig();
        RenderControls();
        RenderWeeklySelector();
    } finally {
        EndRequest();
    }
}

function RenderRawConfig() {
    let FleetOnly = {};
    let StationOnly = {};

    for (let [K, V] of Object.entries(CurrentFullConfig)) {
        if (CurrentStationConfigKeys.includes(K)) {
            StationOnly[K] = V;
        } else {
            FleetOnly[K] = V;
        }
    }

    let Output = "{\n";
    let EscapeHtml = Value => String(Value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    
    let FleetEntries = Object.entries(FleetOnly);
    FleetEntries.forEach(([K, V], I) => {
        let Comma = (I === FleetEntries.length - 1 && Object.keys(StationOnly).length === 0) ? "" : ",";
        Output += `  &quot;${EscapeHtml(K)}&quot;: ${EscapeHtml(JSON.stringify(V))}${Comma}\n`;
    });

    if (Object.keys(StationOnly).length > 0) {
        Output += "\n  <span class=\"station-config-marker\">--- Station config ---</span>\n";
        let StationEntries = Object.entries(StationOnly);
        StationEntries.forEach(([K, V], I) => {
            let Comma = I === StationEntries.length - 1 ? "" : ",";
            Output += `  &quot;${EscapeHtml(K)}&quot;: ${EscapeHtml(JSON.stringify(V))}${Comma}\n`;
        });
    }

    Output += "}";
    document.getElementById('raw-config').innerHTML = Output;
}

function RenderControls() {
    let TogglesContainer = document.getElementById('toggles-container');
    TogglesContainer.innerHTML = '';

    SettingsGroups.forEach((Group, Index) => {
        let GroupDetails = document.createElement('details');
        GroupDetails.className = 'settings-group';
        GroupDetails.open = Group.defaultOpen || Index === 0;

        let Summary = document.createElement('summary');
        Summary.innerHTML = `<span>${Group.title}</span>`;
        GroupDetails.appendChild(Summary);

        Group.items.forEach(Item => {
            if (Item.type === 'spawn') {
                const Row = document.createElement('div');
                Row.className = 'spawn-setting';
                const Selected = getCurrentSpawnSelection(CurrentFullConfig);
                const Dropdown = CreateSpawnSelect(Selected.id);
                const Label = document.createElement('span');
                Label.textContent = Item.label;
                Row.appendChild(Label);
                Row.appendChild(Dropdown);
                GroupDetails.appendChild(Row);
                return;
            }

            let Val = GetBooleanSettingValue(Item);
            let IsChecked = Item.invert ? !Val : Val;
            let Row = document.createElement('div');
            Row.className = 'control-row';
            Row.innerHTML = `
                <span>${Item.label}</span>
                <label class="switch">
                    <input type="checkbox" ${IsChecked ? 'checked' : ''} data-setting-key="${Item.key}" data-invert="${Item.invert ? 'true' : 'false'}" data-confirm-false="${Item.confirmFalse ? 'true' : 'false'}">
                    <span class="slider"></span>
                </label>
            `;
            let Input = Row.querySelector('input');
            Input.addEventListener('change', (Event) => {
                const Key = Event.target.getAttribute('data-setting-key');
                const Invert = Event.target.getAttribute('data-invert') === 'true';
                const ConfirmFalse = Event.target.getAttribute('data-confirm-false') === 'true';
                const NewValue = Event.target.checked;
                if (Key === 'is_whitelist' && !NewValue && ConfirmFalse) {
                    OpenConfirmModal('Disable whitelist?', 'This will turn off the server whitelist. Continue?', async () => {
                        await UpdateGenericSetting(Key, false);
                    });
                    Event.target.checked = true;
                    return;
                }
                UpdateSetting(Key, Invert ? !NewValue : NewValue);
            });
            GroupDetails.appendChild(Row);
        });

        TogglesContainer.appendChild(GroupDetails);
    });

    let GmContainer = document.getElementById('gamemodes-container');
    GmContainer.innerHTML = '';

    let IsTagLoaded = CurrentFullConfig[Gamemodes.Tag.key] === Gamemodes.Tag.value;
    let IsKothLoaded = CurrentFullConfig[Gamemodes.Koth.key] === Gamemodes.Koth.value;
    let IsSmLoaded = CurrentFullConfig[Gamemodes.Sm.key] === Gamemodes.Sm.value;

    GmContainer.appendChild(CreateGamemodeRow(Gamemodes.Tag, IsTagLoaded, () => ToggleTag(!IsTagLoaded)));
    GmContainer.appendChild(CreateGamemodeRow(Gamemodes.Koth, IsKothLoaded, () => ToggleKoth(!IsKothLoaded)));
    GmContainer.appendChild(CreateGamemodeRow(Gamemodes.Sm, IsSmLoaded, () => ToggleSm(!IsSmLoaded)));

    RenderGamemodeConfig();
    RenderWeeklySelector();
}

function CreateGamemodeRow(GmData, IsLoaded, ToggleFn) {
    let Row = document.createElement('div');
    Row.className = 'control-row';
    
    let FixBtnHtml = '';
    
    if (IsLoaded) {
        if (GmData === Gamemodes.Tag) {
            FixBtnHtml += `<button class="fix-btn" onclick="OpenWhitelistModal('${GmData.reqKey}', 'Manage Assistants')">Manage assistants</button>`;
        }
        if (GmData === Gamemodes.Sm && CurrentFullConfig[GmData.reqKey] !== GmData.reqVal) {
            FixBtnHtml = `<button class="fix-btn" onclick="FixSm()">Fix Admins</button>`;
        }
        if (GmData === Gamemodes.Koth) {
            let NeedsFix = 
                GetBooleanSettingValue({ key: "config.player.enableThrusters", default: true }) ||
                GetBooleanSettingValue({ key: "config.player.enableHeartBall", default: true }) ||
                GetBooleanSettingValue({ key: "config.player.tackleEnemyTeamOnly", default: false }) ||
                !GetBooleanSettingValue({ key: "config.player.enableEnemyPlayerGrab", default: true });
                
            if (NeedsFix) {
                FixBtnHtml = `<button class="fix-btn" onclick="FixKoth()">Fix Settings</button>`;
            }
        }
    }

    Row.innerHTML = `
        <div class="control-info">
            <span>${GmData.label}</span>
            ${FixBtnHtml}
        </div>
        <label class="switch">
            <input type="checkbox" ${IsLoaded ? 'checked' : ''} onchange="this.checked = ${IsLoaded}; return false;">
            <span class="slider"></span>
        </label>
    `;
    
    Row.querySelector('input').addEventListener('click', Event => {
        Event.preventDefault();
        ToggleFn();
    });

    return Row;
}

function GetBooleanSettingValue(Setting) {
    let Value = Object.prototype.hasOwnProperty.call(CurrentFullConfig, Setting.key)
        ? CurrentFullConfig[Setting.key]
        : Setting.default;
    return Value === true || Value === "true";
}

function CreateSpawnSelect(CurrentValueId = 'club-district') {
    const Container = document.createElement('div');
    Container.className = 'spawn-select';

    const Toggle = document.createElement('button');
    Toggle.type = 'button';
    Toggle.className = 'spawn-select-toggle button-secondary';
    Toggle.setAttribute('aria-expanded', 'false');

    const Menu = document.createElement('div');
    Menu.className = 'spawn-select-menu hidden';

    const Search = document.createElement('input');
    Search.type = 'search';
    Search.className = 'spawn-select-search';
    Search.placeholder = 'Search spawn...';
    Search.setAttribute('autocomplete', 'off');

    const OptionsWrap = document.createElement('div');
    OptionsWrap.className = 'spawn-select-options';

    const setSelected = (OptionId) => {
        const SelectedOption = SpawnLocationOptions.find((Option) => Option.id === OptionId) || SpawnLocationOptions[0];
        Toggle.textContent = SelectedOption.label;
        [...OptionsWrap.children].forEach((Node) => {
            Node.classList.toggle('active', Node.dataset.optionId === SelectedOption.id);
        });
    };

    const renderOptions = (Query = '') => {
        const SearchText = Query.trim().toLowerCase();
        const Matching = SpawnLocationOptions.filter((Option) => {
            if (!SearchText) return true;
            return Option.label.toLowerCase().includes(SearchText);
        });

        OptionsWrap.innerHTML = '';
        if (Matching.length === 0) {
            const Empty = document.createElement('div');
            Empty.className = 'whitelist-empty-state';
            Empty.textContent = 'No spawns found';
            OptionsWrap.appendChild(Empty);
            return;
        }

        Matching.forEach((Option) => {
            const Button = document.createElement('button');
            Button.type = 'button';
            Button.className = 'spawn-select-option';
            Button.dataset.optionId = Option.id;
            Button.textContent = Option.label;
            Button.classList.toggle('active', Option.id === (CurrentValueId || 'club-district'));
            Button.addEventListener('click', async () => {
                const Update = createSpawnUpdate(Option.id, CurrentFullConfig);
                await SendUpdate({
                    StationUpdates: Update.stationUpdates,
                    StationDeletes: Update.stationDeletes,
                    FleetDeletes: Update.fleetDeletes
                });
                CurrentValueId = Option.id;
                setSelected(Option.id);
                Menu.classList.add('hidden');
                Toggle.setAttribute('aria-expanded', 'false');
            });
            OptionsWrap.appendChild(Button);
        });
    };

    Search.addEventListener('input', (Event) => renderOptions(Event.target.value));
    Toggle.addEventListener('click', (Event) => {
        Event.preventDefault();
        Event.stopPropagation();
        const IsOpen = !Menu.classList.contains('hidden');
        Menu.classList.toggle('hidden', IsOpen);
        Toggle.setAttribute('aria-expanded', String(!IsOpen));
        if (!IsOpen) {
            Search.focus();
        }
    });

    document.addEventListener('click', (Event) => {
        if (!Container.contains(Event.target)) {
            Menu.classList.add('hidden');
            Toggle.setAttribute('aria-expanded', 'false');
        }
    });

    Menu.appendChild(Search);
    Menu.appendChild(OptionsWrap);
    Container.appendChild(Toggle);
    Container.appendChild(Menu);
    renderOptions();
    setSelected(CurrentValueId);
    return Container;
}

function OpenConfirmModal(Title, Message, Callback) {
    const Modal = document.getElementById('confirm-modal');
    if (!Modal) return;
    document.getElementById('confirm-modal-title').textContent = Title;
    document.getElementById('confirm-modal-message').textContent = Message;
    window.__pendingConfirmAction = Callback;
    Modal.classList.add('active');
}

function CloseConfirmModal() {
    const Modal = document.getElementById('confirm-modal');
    if (!Modal) return;
    Modal.classList.remove('active');
    window.__pendingConfirmAction = null;
}

async function ConfirmModalAction() {
    if (typeof window.__pendingConfirmAction === 'function') {
        await window.__pendingConfirmAction();
    }
    CloseConfirmModal();
}

function HandleConfirmBackdropClick(Event) {
    if (Event.target && Event.target.id === 'confirm-modal') {
        CloseConfirmModal();
    }
}

function GetGenericValue(Key, DefaultValue) {
    if (Object.prototype.hasOwnProperty.call(CurrentFullConfig, Key)) {
        let Val = CurrentFullConfig[Key];
        if (typeof DefaultValue === 'boolean') {
            return Val === true || Val === "true";
        }
        if (typeof DefaultValue === 'number') {
            let Num = parseInt(Val, 10);
            return isNaN(Num) ? DefaultValue : Num;
        }
        return Val;
    }
    return DefaultValue;
}

function RouteDelete(Key, StationDeletes, FleetDeletes) {
    if (Object.prototype.hasOwnProperty.call(CurrentStationConfig, Key)) {
        StationDeletes.push(Key);
    } else if (Object.prototype.hasOwnProperty.call(CurrentFullConfig, Key)) {
        FleetDeletes.push(Key);
    }
}

async function SendUpdate(Payload) {
    BeginRequest();
    try {
        let { StationUpdates = {}, StationDeletes = [], FleetUpdates = {}, FleetDeletes = [] } = Payload;

        let CleanStationUpdates = {};
        for (let [K, V] of Object.entries(StationUpdates)) {
            CleanStationUpdates[K] = typeof V === 'boolean' || typeof V === 'number' ? String(V) : V;
        }

        let CleanFleetUpdates = {};
        for (let [K, V] of Object.entries(FleetUpdates)) {
            CleanFleetUpdates[K] = typeof V === 'boolean' || typeof V === 'number' ? String(V) : V;
        }

        let Response = await fetch(`/api/stations/${CurrentStationId}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                stationUpdates: CleanStationUpdates, 
                stationDeletes: StationDeletes,
                fleetUpdates: CleanFleetUpdates,
                fleetDeletes: FleetDeletes
            })
        });

        if (!Response.ok) {
            let ErrorData = await Response.json().catch(() => ({}));
            let ErrorMessage = ErrorData.details
                ? `${ErrorData.error || 'Failed to save configuration'}: ${ErrorData.details}`
                : (ErrorData.error || `Failed to save configuration (${Response.status})`);
            throw new Error(ErrorMessage);
        }

        await RefreshConfig();
    } catch (Error) {
        console.error('Configuration save failed:', Error);
        alert(Error.message || 'Failed to save configuration');
    } finally {
        EndRequest();
    }
}

async function UpdateSetting(Key, NewValue) {
    let StationUpdates = {
        [Key]: Key === "config.player.tackleEnemyTeamOnly" ? !NewValue : NewValue
    };
    let StationDeletes = [];
    let FleetDeletes = [];
    
    RouteDelete(Key, StationDeletes, FleetDeletes);
    
    await SendUpdate({ StationUpdates: StationUpdates, StationDeletes: StationDeletes, FleetDeletes: FleetDeletes });
}

async function UpdateGenericSetting(Key, NewValue) {
    let StationUpdates = { [Key]: NewValue };
    let StationDeletes = [];
    let FleetDeletes = [];
    
    RouteDelete(Key, StationDeletes, FleetDeletes);
    
    await SendUpdate({ StationUpdates: StationUpdates, StationDeletes: StationDeletes, FleetDeletes: FleetDeletes });
}

function RenderWeeklySelector() {
    const Container = document.getElementById('weeklies-container');
    if (!Container) return;

    const currentSelection = getCurrentWeeklySelection(CurrentFullConfig);
    const detectedState = currentSelection && currentSelection.weekly
        ? {
            type: Object.keys(WeeklyEntries).find((type) => WeeklyEntries[type].some((entry) => entry.value === currentSelection.value)) || 'race',
            district: currentSelection.district?.id || 'pink-draft',
            weeklyId: currentSelection.weekly.id
        }
        : { type: 'race', district: 'pink-draft', weeklyId: null };

    const allowedDistricts = WeeklyDistricts.filter((district) => district.allowedTypes.includes(WeeklySelectorState.type));
    const fallbackDistrict = allowedDistricts[0] || WeeklyDistricts[0];
    const safeType = WeeklyTypeOptions.some((option) => option.id === WeeklySelectorState.type) ? WeeklySelectorState.type : detectedState.type;
    const safeDistrict = WeeklyDistricts.some((district) => district.id === WeeklySelectorState.district && district.allowedTypes.includes(safeType))
        ? WeeklySelectorState.district
        : (WeeklyDistricts.find((district) => district.allowedTypes.includes(safeType)) || fallbackDistrict).id;
    const allowedWeeklies = getWeeklyOptionsForType(safeType, safeDistrict);
    const safeWeeklyId = allowedWeeklies.some((entry) => entry.id === WeeklySelectorState.weeklyId)
        ? WeeklySelectorState.weeklyId
        : (detectedState.weeklyId && allowedWeeklies.some((entry) => entry.id === detectedState.weeklyId)
            ? detectedState.weeklyId
            : allowedWeeklies[0]?.id || null);

    WeeklySelectorState = {
        type: safeType,
        district: safeDistrict,
        weeklyId: safeWeeklyId
    };

    const typeOptions = WeeklyTypeOptions.map((option) => `
        <button type="button" class="weekly-type-option ${option.id === WeeklySelectorState.type ? 'active' : ''}" data-weekly-type="${option.id}">${option.label}</button>
    `).join('');

    const districtOptions = WeeklyDistricts
        .filter((district) => district.allowedTypes.includes(WeeklySelectorState.type))
        .map((district) => `
            <option value="${district.id}" ${district.id === WeeklySelectorState.district ? 'selected' : ''}>${district.label}</option>
        `).join('');

    const weeklyList = getWeeklyOptionsForType(WeeklySelectorState.type, WeeklySelectorState.district);
    const weeklyOptions = weeklyList.map((entry) => `
        <option value="${entry.id}" ${entry.id === WeeklySelectorState.weeklyId ? 'selected' : ''}>${entry.label}</option>
    `).join('');

    const hasLoadedWeekly = !!currentSelection;
    const selectedDistrict = WeeklyDistricts.find((district) => district.id === WeeklySelectorState.district) || null;
    const selectedEntry = (WeeklyEntries[WeeklySelectorState.type] || []).find((entry) => entry.id === WeeklySelectorState.weeklyId) || null;
    const sameWeeklySelected = !!currentSelection && !!selectedDistrict && !!selectedEntry && currentSelection.key === selectedDistrict.key && currentSelection.value === selectedEntry.value;
    const spawnDisabled = hasLoadedWeekly && !sameWeeklySelected;
    const unloadAction = hasLoadedWeekly ? `
        <button type="button" class="button-secondary weekly-unload-btn" data-weekly-action="unload">Unload current</button>
    ` : '';

    Container.innerHTML = `
        <div class="weekly-panel">
            <div class="weekly-type-row">
                <span class="weekly-label">Type</span>
                <div class="weekly-type-toggle">${typeOptions}</div>
            </div>
            <div class="weekly-form-grid">
                <label>
                    <span class="weekly-label">District</span>
                    <select class="weekly-select" id="weekly-district-select">
                        ${districtOptions}
                    </select>
                </label>
                <label>
                    <span class="weekly-label">Weekly</span>
                    <select class="weekly-select" id="weekly-entry-select">
                        ${weeklyOptions || '<option value="">No weekly for this district</option>'}
                    </select>
                </label>
            </div>
            <div class="weekly-action-row">
                <button type="button" class="weekly-spawn-btn" id="weekly-spawn-btn" ${!weeklyOptions || spawnDisabled ? 'disabled' : ''}>${spawnDisabled ? 'Unload current first' : 'Spawn Weekly'}</button>
                ${unloadAction}
            </div>
        </div>
    `;

    const typeButtons = Container.querySelectorAll('.weekly-type-option');
    typeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const selectedType = button.dataset.weeklyType;
            const district = WeeklyDistricts.find((option) => option.allowedTypes.includes(selectedType)) || WeeklyDistricts[0];
            const nextWeekly = getWeeklyOptionsForType(selectedType, district.id)[0] || null;
            WeeklySelectorState = {
                type: selectedType,
                district: district.id,
                weeklyId: nextWeekly ? nextWeekly.id : null
            };
            RenderWeeklySelector();
        });
    });

    const districtSelect = document.getElementById('weekly-district-select');
    if (districtSelect) {
        districtSelect.addEventListener('change', () => {
            const nextDistrict = districtSelect.value;
            if (!nextDistrict) return;
            const nextWeeklyList = getWeeklyOptionsForType(WeeklySelectorState.type, nextDistrict);
            const nextWeekly = nextWeeklyList[0] || null;
            WeeklySelectorState = {
                ...WeeklySelectorState,
                district: nextDistrict,
                weeklyId: nextWeekly ? nextWeekly.id : null
            };
            RenderWeeklySelector();
        });
    }

    const weeklySelect = document.getElementById('weekly-entry-select');
    if (weeklySelect) {
        weeklySelect.addEventListener('change', () => {
            const nextWeeklyId = weeklySelect.value;
            if (!nextWeeklyId) return;
            WeeklySelectorState = {
                ...WeeklySelectorState,
                weeklyId: nextWeeklyId
            };
            RenderWeeklySelector();
        });
    }

    const spawnBtn = document.getElementById('weekly-spawn-btn');
    if (spawnBtn) {
        spawnBtn.addEventListener('click', async () => {
            const selectedType = WeeklySelectorState.type || 'race';
            const selectedDistrict = WeeklySelectorState.district || 'pink-draft';
            const selectedWeeklyId = WeeklySelectorState.weeklyId || null;
            const district = WeeklyDistricts.find((entry) => entry.id === selectedDistrict);
            const weekly = (WeeklyEntries[selectedType] || []).find((entry) => entry.id === selectedWeeklyId);
            if (!district || !weekly) return;

            const current = getCurrentWeeklySelection(CurrentFullConfig);
            if (current && current.key !== district.key) {
                return;
            }
            if (current && current.key === district.key && current.value === weekly.value) {
                return;
            }
            if (current && current.key === district.key) {
                const stationDeletes = [];
                const fleetDeletes = [];
                RouteDelete(current.key, stationDeletes, fleetDeletes);
                await SendUpdate({
                    StationDeletes: stationDeletes,
                    FleetDeletes: fleetDeletes,
                    StationUpdates: {
                        [district.key]: weekly.value
                    }
                });
                return;
            }

            await SendUpdate({
                StationUpdates: {
                    [district.key]: weekly.value
                },
                StationDeletes: []
            });
        });
    }

    const unloadBtn = document.querySelector('[data-weekly-action="unload"]');
    if (unloadBtn) {
        unloadBtn.addEventListener('click', async () => {
            const current = getCurrentWeeklySelection(CurrentFullConfig);
            if (!current) return;
            const stationDeletes = [];
            const fleetDeletes = [];
            RouteDelete(current.key, stationDeletes, fleetDeletes);
            await SendUpdate({
                StationDeletes: stationDeletes,
                FleetDeletes: fleetDeletes,
                StationUpdates: {}
            });
        });
    }
}

function RenderGamemodeConfig() {
    let Container = document.getElementById('gamemode-config-container');
    if (!Container) return;
    let OpenStates = [...Container.querySelectorAll('.gm-card')].map(Card => Card.open);
    Container.innerHTML = '';

    const Configs = [
        {
            title: "Driftball Prime",
            toggles: [
                { label: "Kick Losing Team", key: "loadedgamemodes.tkb_prime.modulestate.dashboardconfigoverrides.bkicklosingteam", default: true },
                { label: "Closed Team VOIP", key: "loadedgamemodes.tkb_prime.modulestate.dashboardconfigoverrides.buseclosedteamvoip", default: false },
                { label: "Whitelist Team 0", key: "loadedgamemodes.tkb_prime.modulestate.dashboardconfigoverrides.buseteam0whitelist", default: false, whitelistKey: "loadedgamemodes.tkb_prime.modulestate.dashboardconfigoverrides.team0whitelist", whitelistTitle: "Manage Team 0 Whitelist" },
                { label: "Whitelist Team 1", key: "loadedgamemodes.tkb_prime.modulestate.dashboardconfigoverrides.buseteam1whitelist", default: false, whitelistKey: "loadedgamemodes.tkb_prime.modulestate.dashboardconfigoverrides.team1whitelist", whitelistTitle: "Manage Team 1 Whitelist" }
            ],
            numbers: [
                { label: "Max Team 0 Size", key: "loadedgamemodes.tkb_prime.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.0", default: 3 },
                { label: "Max Team 1 Size", key: "loadedgamemodes.tkb_prime.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.1", default: 3 }
            ]
        },
        {
            title: "Z-Drift Left",
            toggles: [
                { label: "Kick Losing Team", key: "loadedgamemodes.zdrift_01.modulestate.dashboardconfigoverrides.bkicklosingteam", default: true },
                { label: "Use Whitelist", key: "loadedgamemodes.zdrift_01.modulestate.dashboardconfigoverrides.busewhitelist", default: false, customWhitelist: true }
            ],
            numbers: [
                { label: "Max Team 0 Size", key: "loadedgamemodes.zdrift_01.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.0", default: 4 },
                { label: "Max Team 1 Size", key: "loadedgamemodes.zdrift_01.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.1", default: 4 }
            ]
        },
        {
            title: "Driftblitz Front",
            toggles: [
                { label: "Kick Losing Team", key: "loadedgamemodes.driftplexsoccerwestfront.modulestate.dashboardconfigoverrides.bkicklosingteam", default: true },
                { label: "Use Closed Team VOIP", key: "loadedgamemodes.driftplexsoccerwestfront.modulestate.dashboardconfigoverrides.buseclosedteamvoip", default: false },
                { label: "Use Team 0 Whitelist", key: "loadedgamemodes.driftplexsoccerwestfront.modulestate.dashboardconfigoverrides.buseteam0whitelist", default: false, whitelistKey: "loadedgamemodes.driftplexsoccerwestfront.modulestate.dashboardconfigoverrides.team0whitelist", whitelistTitle: "Manage Team 0 Whitelist" },
                { label: "Use Team 1 Whitelist", key: "loadedgamemodes.driftplexsoccerwestfront.modulestate.dashboardconfigoverrides.buseteam1whitelist", default: false, whitelistKey: "loadedgamemodes.driftplexsoccerwestfront.modulestate.dashboardconfigoverrides.team1whitelist", whitelistTitle: "Manage Team 1 Whitelist" }
            ],
            numbers: [
                { label: "Max Team 0 Size", key: "loadedgamemodes.driftplexsoccerwestfront.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.0", default: 20 },
                { label: "Max Team 1 Size", key: "loadedgamemodes.driftplexsoccerwestfront.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.1", default: 20 }
            ]
        },
        {
            title: "Capture The Beacon",
            toggles: [
                { label: "Cap Team Sizes", key: "loadedgamemodes.pkr_ctf_01.modulestate.dashboardconfigoverrides.capteamsizes", default: false }
            ],
            numbers: [
                { label: "Points to Win", key: "loadedgamemodes.pkr_ctf_01.modulestate.dashboardconfigoverrides.pointstowin", default: 3 }
            ]
        }
    ];

    Configs.forEach((Gm, Index) => {
        let GmCard = document.createElement('details');
        GmCard.className = 'gm-card';
        GmCard.open = OpenStates[Index] || false;
        
        let CardSummary = document.createElement('summary');
        let TitleEl = document.createElement('h3');
        TitleEl.className = 'gm-card-title';
        TitleEl.textContent = Gm.title;

        let ResetButton = document.createElement('button');
        ResetButton.className = 'button-secondary reset-btn';
        ResetButton.textContent = 'Reset to defaults';
        ResetButton.hidden = !GamemodeHasOverrides(Gm);
        ResetButton.onclick = Event => {
            Event.preventDefault();
            Event.stopPropagation();
            ResetGamemodeConfig(Gm);
        };

        let CardHeader = document.createElement('div');
        CardHeader.className = 'gm-card-header';
        CardHeader.append(TitleEl, ResetButton);
        CardSummary.appendChild(CardHeader);
        GmCard.appendChild(CardSummary);

        Gm.toggles.forEach(Tog => {
            let Val = GetGenericValue(Tog.key, Tog.default);
            let Row = document.createElement('div');
            Row.className = 'control-row';
            
            let BtnHtml = '';
            if (Val && Tog.whitelistKey) {
                BtnHtml = `<button class="button-secondary whitelist-btn" onclick="OpenWhitelistModal('${Tog.whitelistKey}', '${Tog.whitelistTitle}')">Manage whitelist</button>`;
            } else if (Val && Tog.customWhitelist) {
                BtnHtml = `
                    <button class="button-secondary whitelist-btn" onclick="OpenWhitelistModal('loadedgamemodes.zdrift_01.modulestate.dashboardconfigoverrides.team0whitelist', 'Manage Team 0 whitelist')">Manage Team 0 whitelist</button>
                    <button class="button-secondary whitelist-btn" onclick="OpenWhitelistModal('loadedgamemodes.zdrift_01.modulestate.dashboardconfigoverrides.team1whitelist', 'Manage Team 1 whitelist')">Manage Team 1 whitelist</button>
                `;
            }

            Row.innerHTML = `
                <div class="control-info">
                    <span>${Tog.label}</span>
                    ${BtnHtml}
                </div>
                <label class="switch">
                    <input type="checkbox" ${Val ? 'checked' : ''} onchange="UpdateGenericSetting('${Tog.key}', this.checked)">
                    <span class="slider"></span>
                </label>
            `;
            GmCard.appendChild(Row);
        });

        Gm.numbers.forEach(Num => {
            let Val = GetGenericValue(Num.key, Num.default);
            let Row = document.createElement('div');
            Row.className = 'control-row';
            Row.innerHTML = `
                <div class="control-info">
                    <span>${Num.label}</span>
                </div>
                <input type="number" class="number-input" value="${Val}" onchange="UpdateGenericSetting('${Num.key}', parseInt(this.value, 10))">
            `;
            GmCard.appendChild(Row);
        });

        Container.appendChild(GmCard);
    });
}

function GamemodeHasOverrides(Gamemode) {
    return Gamemode.toggles.some(Toggle => GetGenericValue(Toggle.key, Toggle.default) !== Toggle.default) ||
    Gamemode.numbers.some(Number => GetGenericValue(Number.key, Number.default) !== Number.default) ||
    Gamemode.toggles.some(Toggle => Toggle.whitelistKey && Object.prototype.hasOwnProperty.call(CurrentFullConfig, Toggle.whitelistKey));
}

async function ResetGamemodeConfig(Gamemode) {
    let StationUpdates = {};
    let StationDeletes = [];
    let FleetDeletes = [];

    Gamemode.toggles.forEach(Toggle => {
        StationUpdates[Toggle.key] = Toggle.default;
        if (Toggle.whitelistKey) {
            RouteDelete(Toggle.whitelistKey, StationDeletes, FleetDeletes);
        }
    });

    Gamemode.numbers.forEach(Number => {
        StationUpdates[Number.key] = Number.default;
    });

    await SendUpdate({ StationUpdates: StationUpdates, StationDeletes: StationDeletes, FleetDeletes: FleetDeletes });
}

let WhitelistSelectedPlayers = [];
let WhitelistSelectedGroups = [];

function OpenWhitelistModal(Key, Title) {
    ActiveWhitelistKey = Key;
    document.getElementById('modal-title').textContent = Title;
    
    let CurrentVal = CurrentFullConfig[Key] || "";
    let CurrentPlayers = CurrentVal.split(',').map(S => S.trim()).filter(Boolean);
    
    WhitelistSelectedPlayers = [...CurrentPlayers];
    WhitelistSelectedGroups = [];
    
    RenderWhitelistGroups();
    RenderWhitelistSelectedPlayers();
    
    let SearchInput = document.getElementById('whitelist-player-search');
    if (SearchInput) {
        SearchInput.value = '';
        SearchInput.removeEventListener('input', HandleWhitelistSearch);
        SearchInput.addEventListener('input', HandleWhitelistSearch);
    }
    
    document.getElementById('whitelist-modal').classList.add('active');
}

function RenderWhitelistGroups() {
    let Container = document.getElementById('modal-groups-container');
    Container.innerHTML = '';
    
    CustomGroups.forEach(Group => {
        let GroupRow = document.createElement('div');
        GroupRow.className = 'whitelist-group-row';
        
        let Checkbox = document.createElement('input');
        Checkbox.type = 'checkbox';
        Checkbox.id = `group-whitelist-${Group.id}`;
        Checkbox.checked = WhitelistSelectedGroups.includes(Group.id);
        Checkbox.addEventListener('change', (E) => {
            ToggleWhitelistGroup(Group, E.target.checked);
        });
        
        let Label = document.createElement('label');
        Label.htmlFor = `group-whitelist-${Group.id}`;
        Label.textContent = Group.label;
        
        GroupRow.appendChild(Checkbox);
        GroupRow.appendChild(Label);
        Container.appendChild(GroupRow);
    });
}

function ToggleWhitelistGroup(Group, IsChecked) {
    if (IsChecked) {
        if (!WhitelistSelectedGroups.includes(Group.id)) {
            WhitelistSelectedGroups.push(Group.id);
        }
        Group.players.forEach(Player => {
            if (!WhitelistSelectedPlayers.includes(Player.username)) {
                WhitelistSelectedPlayers.push(Player.username);
            }
        });
    } else {
        WhitelistSelectedGroups = WhitelistSelectedGroups.filter(Id => Id !== Group.id);
        let OtherGroupPlayers = new Set();
        CustomGroups
            .filter(G => WhitelistSelectedGroups.includes(G.id))
            .forEach(G => {
                G.players.forEach(P => {
                    OtherGroupPlayers.add(P.username);
                });
            });
        
        WhitelistSelectedPlayers = WhitelistSelectedPlayers.filter(Player => {
            let PlayerInThisGroup = Group.players.some(P => P.username === Player);
            return !PlayerInThisGroup || OtherGroupPlayers.has(Player);
        });
    }
    RenderWhitelistSelectedPlayers();
}

function HandleWhitelistSearch(E) {
    clearTimeout(SearchTimeout);
    SearchTimeout = setTimeout(() => {
        SearchWhitelistPlayers(E.target.value);
    }, 300);
}

async function SearchWhitelistPlayers(Query) {
    let Results = document.getElementById('whitelist-player-search-results');
    Query = Query.trim().toLowerCase();
    
    if (!Query) {
        Results.classList.add('hidden');
        return;
    }

    try {
        let Res = await fetch('/api/players/search?q=' + encodeURIComponent(Query));
        let Data = await Res.json();
        
        Results.innerHTML = '';
        if (Data.items && Data.items.length > 0) {
            Data.items.forEach(Player => {
                if (!WhitelistSelectedPlayers.includes(Player.username)) {
                    let Div = document.createElement('div');
                    Div.className = 'search-result-item';
                    Div.textContent = Player.username;
                    Div.style.cssText = 'padding: 0.5rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--border); font-size: 0.85rem;';
                    Div.onclick = () => AddWhitelistPlayer(Player.username);
                    Results.appendChild(Div);
                }
            });
            Results.classList.remove('hidden');
        } else {
            Results.classList.add('hidden');
        }
    } catch (e) {
        Results.classList.add('hidden');
    }
}

function AddWhitelistPlayer(Username) {
    if (!WhitelistSelectedPlayers.includes(Username)) {
        WhitelistSelectedPlayers.push(Username);
    }
    RenderWhitelistSelectedPlayers();
    document.getElementById('whitelist-player-search').value = '';
    document.getElementById('whitelist-player-search-results').classList.add('hidden');
}

function RemoveWhitelistPlayer(Username) {
    WhitelistSelectedPlayers = WhitelistSelectedPlayers.filter(P => P !== Username);
    RenderWhitelistSelectedPlayers();
}

function RenderWhitelistSelectedPlayers() {
    let Container = document.getElementById('whitelist-selected-players');
    Container.innerHTML = '';
    
    let UniquePlayers = [...new Set(WhitelistSelectedPlayers)].sort();
    
    if (UniquePlayers.length === 0) {
        let Empty = document.createElement('p');
        Empty.className = 'whitelist-empty-state';
        Empty.textContent = 'No players selected';
        Container.appendChild(Empty);
        return;
    }
    
    UniquePlayers.forEach(Player => {
        let PlayerDiv = document.createElement('div');
        PlayerDiv.className = 'whitelist-player-tag';
        
        let NameSpan = document.createElement('span');
        NameSpan.textContent = Player;
        
        let RemoveBtn = document.createElement('button');
        RemoveBtn.className = 'whitelist-player-remove';
        RemoveBtn.textContent = '×';
        RemoveBtn.onclick = (E) => {
            E.preventDefault();
            RemoveWhitelistPlayer(Player);
        };
        
        PlayerDiv.appendChild(NameSpan);
        PlayerDiv.appendChild(RemoveBtn);
        Container.appendChild(PlayerDiv);
    });
}

function CloseWhitelistModal() {
    document.getElementById('whitelist-modal').classList.remove('active');
    ActiveWhitelistKey = null;
}

function HandleModalBackdropClick(Event) {
    if (Event.target && Event.target.id === 'whitelist-modal') {
        CloseWhitelistModal();
    }
}

function CloseConfirmModalAction() {
    CloseConfirmModal();
}

function RenderWhitelistGroups() {
    let Container = document.getElementById('modal-groups-container');
    if (!Container) return;
    Container.innerHTML = '';
    
    CustomGroups.forEach(Group => {
        let GroupRow = document.createElement('div');
        GroupRow.className = 'whitelist-group-row';
        
        let Checkbox = document.createElement('input');
        Checkbox.type = 'checkbox';
        Checkbox.id = `group-whitelist-${Group.id}`;
        Checkbox.checked = WhitelistSelectedGroups.includes(Group.id);
        Checkbox.addEventListener('change', (E) => {
            ToggleWhitelistGroup(Group, E.target.checked);
        });
        
        let Label = document.createElement('label');
        Label.htmlFor = `group-whitelist-${Group.id}`;
        Label.textContent = Group.label;
        
        GroupRow.appendChild(Checkbox);
        GroupRow.appendChild(Label);
        Container.appendChild(GroupRow);
    });
}

window.migrategroup = async function(name, playersStr) {
    const usernames = playersStr.split(',').map(s => s.trim()).filter(Boolean);
    const validPlayers = [];

    console.log(`Starting migration for "${name}". Total queries: ${usernames.length}`);

    for (const username of usernames) {
        try {
            const res = await fetch('/api/players/search?q=' + encodeURIComponent(username));
            const data = await res.json();
            
            const match = data.items && data.items.find(p => p.username.toLowerCase() === username.toLowerCase());
            
            if (match) {
                validPlayers.push({ id: match.user_id, username: match.username });
                console.log(`[+] Found: ${match.username}`);
            } else {
                console.warn(`[-] Not found: ${username}`);
            }
        } catch (err) {
            console.error(`[!] Request failed for ${username}:`, err);
        }
        
        await new Promise(r => setTimeout(r, 1100));
    }

    if (validPlayers.length > 0) {
        console.log(`Saving group "${name}" with ${validPlayers.length} valid players...`);
        try {
            const res = await fetch('/api/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, players: validPlayers })
            });
            
            if (res.ok) {
                console.log(`[Success] Group "${name}" inserted into database.`);
                if (typeof window.LoadGroups === 'function') {
                    window.LoadGroups();
                }
            } else {
                console.error(`[!] Group creation rejected by server.`);
            }
        } catch (err) {
            console.error(`[!] Database insertion failed:`, err);
        }
    } else {
        console.warn(`[!] Migration aborted. Zero valid players found.`);
    }
};

function RenderWhitelistSelectedPlayers() {
    let Container = document.getElementById('whitelist-selected-players');
    if (!Container) return;
    Container.innerHTML = '';
    
    let UniquePlayers = [...new Set(WhitelistSelectedPlayers)].sort();
    
    if (UniquePlayers.length === 0) {
        let Empty = document.createElement('p');
        Empty.className = 'whitelist-empty-state';
        Empty.textContent = 'No players selected';
        Container.appendChild(Empty);
        return;
    }
    
    UniquePlayers.forEach(Player => {
        let PlayerDiv = document.createElement('div');
        PlayerDiv.className = 'whitelist-player-tag';
        
        let NameSpan = document.createElement('span');
        NameSpan.textContent = Player;
        
        let RemoveBtn = document.createElement('button');
        RemoveBtn.className = 'whitelist-player-remove';
        RemoveBtn.textContent = '×';
        RemoveBtn.onclick = (E) => {
            E.preventDefault();
            RemoveWhitelistPlayer(Player);
        };
        
        PlayerDiv.appendChild(NameSpan);
        PlayerDiv.appendChild(RemoveBtn);
        Container.appendChild(PlayerDiv);
    });
}

async function SaveWhitelistModal() {
    if (!ActiveWhitelistKey) return;

    let UniquePlayers = [...new Set(WhitelistSelectedPlayers)];
    let ValString = UniquePlayers.join(',');

    let StationUpdates = { [ActiveWhitelistKey]: ValString };

    CloseWhitelistModal();
    await SendUpdate({ StationUpdates: StationUpdates, StationDeletes: [], FleetDeletes: [] });
}

async function ToggleTag(Enable) {
    let StationUpdates = {};
    let StationDeletes = [];
    let FleetDeletes = [];
    
    if (Enable) {
        StationUpdates[Gamemodes.Tag.key] = Gamemodes.Tag.value;
        
        RouteDelete(Gamemodes.Tag.key, StationDeletes, FleetDeletes);
    } else {
        RouteDelete(Gamemodes.Tag.key, StationDeletes, FleetDeletes);
        RouteDelete(Gamemodes.Tag.reqKey, StationDeletes, FleetDeletes);
    }
    
    await SendUpdate({ StationUpdates: StationUpdates, StationDeletes: StationDeletes, FleetDeletes: FleetDeletes });
}

async function FixTag() {
    let StationUpdates = {
        [Gamemodes.Tag.reqKey]: Gamemodes.Tag.reqVal
    };
    await SendUpdate({ StationnUpdates: StationUpdates });
}

async function RemoveAssistants() {
    let StationDeletes = [];
    let FleetDeletes = [];
    RouteDelete(Gamemodes.Tag.reqKey, StationDeletes, FleetDeletes);
    await SendUpdate({ StationDeletes: StationDeletes, FleetDeletes: FleetDeletes });
}

async function ToggleKoth(Enable) {
    let StationUpdates = {};
    let StationDeletes = [];
    let FleetDeletes = [];
    
    if (Enable) {
        StationUpdates[Gamemodes.Koth.key] = Gamemodes.Koth.value;
        StationUpdates["config.player.enableThrusters"] = false;
        StationUpdates["config.player.enableHeartBall"] = false;
        StationUpdates["config.player.tackleEnemyTeamOnly"] = true;
        StationUpdates["config.player.enableEnemyPlayerGrab"] = false;
        
        RouteDelete(Gamemodes.Koth.key, StationDeletes, FleetDeletes);
        RouteDelete("config.player.enableThrusters", StationDeletes, FleetDeletes);
        RouteDelete("config.player.enableHeartBall", StationDeletes, FleetDeletes);
        RouteDelete("config.player.tackleEnemyTeamOnly", StationDeletes, FleetDeletes);
        RouteDelete("config.player.enableEnemyPlayerGrab", StationDeletes, FleetDeletes);
    } else {
        RouteDelete(Gamemodes.Koth.key, StationDeletes, FleetDeletes);
        StationUpdates["config.player.enableThrusters"] = true;
        StationUpdates["config.player.enableHeartBall"] = true;
        StationUpdates["config.player.tackleEnemyTeamOnly"] = false;
        StationUpdates["config.player.enableEnemyPlayerGrab"] = true;
    }
    
    await SendUpdate({ StationUpdates: StationUpdates, StationDeletes: StationDeletes, FleetDeletes: FleetDeletes });
}

async function FixKoth() {
    let StationUpdates = {
        "config.player.enableThrusters": false,
        "config.player.enableHeartBall": false,
        "config.player.tackleEnemyTeamOnly": true,
        "config.player.enableEnemyPlayerGrab": false
    };
    await SendUpdate({ StationUpdates: StationUpdates });
}

async function ToggleSm(Enable) {
    let StationUpdates = {};
    let StationDeletes = [];
    let FleetDeletes = [];
    
    if (Enable) {
        StationUpdates[Gamemodes.Sm.key] = Gamemodes.Sm.value;
        StationUpdates[Gamemodes.Sm.reqKey] = Gamemodes.Sm.reqVal;
        
        RouteDelete(Gamemodes.Sm.key, StationDeletes, FleetDeletes);
        RouteDelete(Gamemodes.Sm.reqKey, StationDeletes, FleetDeletes);
    } else {
        RouteDelete(Gamemodes.Sm.key, StationDeletes, FleetDeletes);
        RouteDelete(Gamemodes.Sm.reqKey, StationDeletes, FleetDeletes);
    }
    
    await SendUpdate({ StationUpdates: StationUpdates, StationDeletes: StationDeletes, FleetDeletes: FleetDeletes });
}

async function FixSm() {
    let StationUpdates = {
        [Gamemodes.Sm.reqKey]: Gamemodes.Sm.reqVal
    };
    await SendUpdate({ StationUpdates: StationUpdates });
}

function Logout() {
    // Clear all cookies
    document.cookie.split(";").forEach(function(c) {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
    // Redirect to setup
    window.location.href = '/setup.html';
}

document.addEventListener('DOMContentLoaded', () => {
    let LogoutButton = document.getElementById('logout-button');
    if (LogoutButton) {
        LogoutButton.addEventListener('click', (Event) => {
            Event.stopPropagation();
            Logout();
        });
    }
});

InitializeLayoutDivider();
Init();