let CurrentStationId = null;
let CurrentFullConfig = {};
let CurrentStationConfig = {};
let CurrentStationConfigKeys = [];
let CurrentFleetConfig = {};
let ActiveWhitelistKey = null;
let PendingRequests = 0;
let WeeklySelectorState = { type: 'race', district: 'pink-draft', weeklyId: null };
let StationConfigEditing = false;
let StationConfigEditorOriginal = '';

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
            { label: 'Fireworks', key: 'config.visualEffects.fireworksOn', type: 'boolean', default: false },
            { label: 'Default Spawn', key: 'config.spawnPointSettings.overrideSpawnPoint', type: 'spawn', default: false }
        ]
    },
    {
        title: 'Teams',
        items: [
            { label: 'Disable Team Tackle', key: 'config.player.tackleEnemyTeamOnly', type: 'boolean', default: true },
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
    }
};

function SetRequestState(IsLoading) {
    let LoadingBar = document.getElementById('page-loading-bar');
    if (!LoadingBar) return;
    LoadingBar.classList.toggle('active', IsLoading);
    LoadingBar.setAttribute('aria-hidden', String(!IsLoading));
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

function SetStationPageLoading(IsLoading) {
    document.getElementById('view-station')?.classList.toggle('is-loading', IsLoading);
}

async function Init() {
    BeginRequest();
    try {
        var AuthRes = await fetch('/api/me');
        if (!AuthRes.ok) {
            window.location.href = '/setup.html';
            return;
        }
        await AuthRes.json();
    } finally {
        EndRequest();
    }
    await RefreshStations();
}

function GetRegionLabel(Region) {
    return Region === 'eu-central-1' ? 'EU' : Region === 'us-east-2' ? 'NA' : Region;
}

async function RefreshStations() {
    const Container = document.getElementById('station-list');
    const RefreshButton = document.getElementById('stations-refresh');
    if (!Container) return;
    if (RefreshButton) RefreshButton.disabled = true;
    Container.innerHTML = Array.from({ length: 2 }, () => '<div class="card station-skeleton" aria-hidden="true"><span></span><span></span></div>').join('');
    BeginRequest();
    try {
        const Response = await fetch('/api/stations');
        const Data = await Response.json();
        if (!Response.ok) throw new Error(Data.error || 'Failed to fetch stations');

        const OnlineStations = (Data.stations || []).filter(Station => Station.online);
        if (OnlineStations.length === 0) {
            Container.innerHTML = '<p class="station-list-empty">No online stations available.</p>';
            return;
        }

        const MaxVersion = Math.max(...OnlineStations.map(Station => parseInt(Station.version, 10)));
        const TargetStations = OnlineStations.filter(Station => parseInt(Station.version, 10) === MaxVersion);
        Container.innerHTML = '';
        TargetStations.forEach(Station => {
            const Card = document.createElement('div');
            Card.className = 'card station-card';
            const StationTitle = document.createElement('h3');
            StationTitle.className = 'station-region-title';
            StationTitle.textContent = GetRegionLabel(Station.region);
            const StationName = document.createElement('div');
            StationName.className = 'station-card-name';
            StationName.textContent = Station.station_name;
            const StationDetails = document.createElement('div');
            StationDetails.className = 'station-card-details';
            StationDetails.textContent = `${Station.player_count} players · Version ${Station.version}`;
            Card.append(StationTitle, StationName, StationDetails);
            Card.onclick = () => SelectStation(Station.station_id, Station.station_name, Station.region);
            Container.appendChild(Card);
        });
    } catch (Error) {
        Container.innerHTML = '';
        const ErrorMessage = document.createElement('p');
        ErrorMessage.className = 'station-list-empty is-error';
        ErrorMessage.textContent = Error.message || 'Failed to fetch stations.';
        Container.appendChild(ErrorMessage);
    } finally {
        if (RefreshButton) RefreshButton.disabled = false;
        EndRequest();
    }
}

let SearchTimeout;
const PlayerSearchDelay = 180;
const BulkPlayerSearchDelay = 700;
let AllFleetRoles = [];
let PlayerLookupGeneration = 0;
let OnlinePlayersRefreshTimer = null;
let OnlineRoleTargetId = null;
let CurrentPlayersViewMode = 'online';
let CurrentSelectionTargets = [];
let OnlinePlayersRefreshGeneration = 0;
const OnlinePlayerWindowMs = 5 * 60 * 1000;
let MissingPlayerNames = [];
let CurrentSelectionIsGroup = false;

function SetOnlinePlayersStatus(Message) {
    const Status = document.getElementById('online-players-status');
    if (Status) Status.textContent = Message;
    const MissingButton = document.getElementById('missing-players-open');
    if (MissingButton) MissingButton.classList.toggle('hidden', MissingPlayerNames.length === 0);
}

function UpdateMissingPlayerNames(Names) {
    MissingPlayerNames = [...new Set(Names.filter(Boolean))];
    const Button = document.getElementById('missing-players-open');
    if (Button) {
        Button.classList.toggle('hidden', MissingPlayerNames.length === 0);
        Button.textContent = `Not found (${MissingPlayerNames.length})`;
    }
}

function OpenMissingPlayersModal() {
    const List = document.getElementById('missing-players-list');
    if (!List) return;
    List.innerHTML = '';
    MissingPlayerNames.forEach(Name => {
        const Item = document.createElement('li');
        Item.textContent = Name;
        List.appendChild(Item);
    });
    document.getElementById('missing-players-modal').classList.add('active');
}

function CloseMissingPlayersModal() {
    document.getElementById('missing-players-modal').classList.remove('active');
}

function HandleMissingPlayersBackdropClick(Event) {
    if (Event.target && Event.target.id === 'missing-players-modal') CloseMissingPlayersModal();
}

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
    document.getElementById('online-players-refresh')?.addEventListener('click', () => {
        CurrentPlayersViewMode = 'online';
        CurrentSelectionIsGroup = false;
        RefreshOnlinePlayers();
    });

    document.querySelectorAll('.page-tab').forEach((TabButton) => {
        TabButton.addEventListener('click', () => SetMainTab(TabButton.dataset.tab));
    });
    
    let SearchInput = document.getElementById('player-search-input');
    if (SearchInput) {
        SearchInput.addEventListener('input', function(E) {
            clearTimeout(SearchTimeout);
            const LookupGeneration = ++PlayerLookupGeneration;
            let Query = E.target.value.trim();
            let ResultsContainer = document.getElementById('player-search-results');

            if (Query.length === 0) {
                ResultsContainer.classList.add('hidden');
                return;
            }

            if (Query.includes(',')) {
                const Usernames = Query.split(',').map(Username => Username.trim()).filter(Boolean);
                if (Usernames.length < 2) {
                    ResultsContainer.classList.add('hidden');
                    return;
                }
                SearchTimeout = setTimeout(() => ResolveCommaSeparatedPlayers(Usernames, LookupGeneration), BulkPlayerSearchDelay);
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
            }, PlayerSearchDelay);
        });

        SearchInput.addEventListener('keydown', Event => {
            if (Event.key !== 'Enter' || !SearchInput.value.includes(',')) return;
            const Usernames = SearchInput.value.split(',').map(Username => Username.trim()).filter(Boolean);
            if (Usernames.length < 2) return;
            Event.preventDefault();
            clearTimeout(SearchTimeout);
            ResolveCommaSeparatedPlayers(Usernames, ++PlayerLookupGeneration);
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
            }, PlayerSearchDelay);
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
            }, PlayerSearchDelay);
        });
    }

    FetchFleetRoles();

    let RoleSearchInput = document.getElementById('role-search-input');
    if (RoleSearchInput) {
        RoleSearchInput.addEventListener('input', Event => RenderAvailableRoles(Event.target.value));
    }
});

let ActiveRoleTargets = [];
let PendingRoleRemoval = null;
let PendingRoleRemovalTargets = [];

function SetPlayerLookupStatus(Container, Message, State = 'loading') {
    Container.innerHTML = '';
    const Status = document.createElement('div');
    Status.className = 'player-lookup-status';
    Status.dataset.state = State;

    const Indicator = document.createElement('span');
    Indicator.className = State === 'loading' ? 'player-lookup-spinner' : 'player-lookup-status-icon';
    Indicator.setAttribute('aria-hidden', 'true');
    if (State !== 'loading') Indicator.textContent = 'i';

    const Text = document.createElement('span');
    Text.textContent = Message;
    Status.append(Indicator, Text);
    Container.appendChild(Status);
}

async function ResolveCommaSeparatedPlayers(Usernames, LookupGeneration) {
    const ResultsContainer = document.getElementById('player-search-results');
    const Players = [];
    const FoundIds = new Set();
    const MissingUsernames = [];

    SetPlayerLookupStatus(ResultsContainer, `Looking up ${Usernames.length} players one by one...`);
    ResultsContainer.classList.remove('hidden');
    BeginRequest();
    try {
        for (let Index = 0; Index < Usernames.length; Index++) {
            if (LookupGeneration !== PlayerLookupGeneration) return;
            const Username = Usernames[Index];
            SetPlayerLookupStatus(ResultsContainer, `Looking up player ${Index + 1} of ${Usernames.length}: ${Username}`);

            try {
                const Res = await fetch('/api/players/search?q=' + encodeURIComponent(Username));
                const Data = await Res.json();
                const Match = (Data.items || []).find(Player =>
                    String(Player.username || '').toLowerCase() === Username.toLowerCase()
                );

                if (Match) {
                    if (!FoundIds.has(Match.user_id)) {
                        FoundIds.add(Match.user_id);
                        Players.push({ id: Match.user_id, username: Match.username });
                    }
                } else {
                    MissingUsernames.push(Username);
                }
            } catch (Error) {
                MissingUsernames.push(Username);
                console.error(`Player lookup failed for ${Username}:`, Error);
            }

            if (Index < Usernames.length - 1) await Delay(1100);
        }

        if (LookupGeneration !== PlayerLookupGeneration) return;
        if (Players.length === 0) {
            UpdateMissingPlayerNames(MissingUsernames);
            SetOnlinePlayersStatus('No matching players found.');
            SetPlayerLookupStatus(ResultsContainer, 'No matching players found. Check the usernames and try again.', 'empty');
            ResultsContainer.classList.remove('hidden');
            return;
        }

        await SelectPlayers(Players, `${Players.length} players`, MissingUsernames);
    } finally {
        EndRequest();
    }
}

async function SelectPlayer(Id, Username) {
    await SelectPlayers([{ id: Id, username: Username }], Username);
}

async function SelectPlayers(Players, DisplayName, MissingNames = [], IsGroup = false) {
    PlayerLookupGeneration += 1;
    CurrentPlayersViewMode = 'selection';
    CurrentSelectionTargets = [...Players];
    CurrentSelectionIsGroup = IsGroup;
    ActiveRoleTargets = [...Players];
    OnlineRoleTargetId = null;
    UpdateMissingPlayerNames(MissingNames);
    document.getElementById('player-search-results').classList.add('hidden');
    document.getElementById('player-search-input').value = '';
    SetOnlinePlayersStatus(Players.length > 1 || IsGroup ? `0/${Players.length} Checking…` : 'Checking roles…');
    await LoadPlayerRoles();
}

async function SelectGroup(Group) {
    await SelectPlayers(Group.players, Group.label + " (Group)", [], true);
}

async function LoadPlayerRoles() {
    if (ActiveRoleTargets.length === 0) return;
    const Targets = [...ActiveRoleTargets];
    const TargetSignature = Targets.map(Target => Target.id).join('|');
    BeginRequest();
    try {
        const Players = Targets.map(Target => ({ ...Target, roles: [] }));
        const MissingNames = [...MissingPlayerNames];
        for (let Index = 0; Index < Targets.length; Index++) {
            const Target = Targets[Index];
            const Player = Players.find(Entry => Entry.id === Target.id);
            SetOnlinePlayersStatus(`${Index + 1}/${Targets.length} ${Target.username}`);
            try {
                const Res = await fetch(`/api/players/${encodeURIComponent(Target.id)}/roles`);
                const Data = await Res.json();
                if (!Res.ok) {
                    const Error = new Error(Data.error || 'Failed to fetch player roles');
                    Error.status = Res.status;
                    throw Error;
                }
                Player.roles = Array.isArray(Data.roles) ? Data.roles : [];
            } catch (Error) {
                console.error(`Failed to load roles for ${Target.username}:`, Error);
                if (Error.status === 404) {
                    MissingNames.push(Target.username);
                    Player.notFound = true;
                } else {
                    Player.rolesUnavailable = true;
                }
            }
            if (Index < Targets.length - 1) await Delay(300);
        }

        const CurrentSelectionSignature = CurrentSelectionTargets.map(Target => Target.id).join('|');
        if (TargetSignature !== CurrentSelectionSignature || CurrentPlayersViewMode !== 'selection') return;
        UpdateMissingPlayerNames(MissingNames);
        RenderPlayersTable(Players, CurrentSelectionIsGroup || CurrentSelectionTargets.length > 1);
        SetOnlinePlayersStatus('');
    } finally {
        EndRequest();
    }
}

function RenderPlayersTable(Players, IsGroup = false) {
    const Body = document.getElementById('online-players-body');
    if (!Body) return;
    Body.innerHTML = '';

    const RoleDetails = new Map();
    Players.forEach(Player => {
        (Player.roles || []).forEach(Role => {
            const RoleId = Role.role_id || Role.name || Role.role_name;
            if (!RoleId) return;
            if (!RoleDetails.has(RoleId)) RoleDetails.set(RoleId, { role: Role, owners: [] });
            RoleDetails.get(RoleId).owners.push({ id: Player.id || Player.user_id, username: Player.username });
        });
    });

    if (IsGroup) {
        const SharedRow = document.createElement('tr');
        SharedRow.className = 'online-player-shared-row';
        const SharedNameCell = document.createElement('td');
        SharedNameCell.className = 'online-player-name';
        SharedNameCell.textContent = 'Shared';

        const SharedRolesCell = document.createElement('td');
        SharedRolesCell.className = 'online-player-roles';
        const SharedRoleDetails = [...RoleDetails.values()].filter(Details => Details.owners.length === Players.length);
        if (SharedRoleDetails.length === 0) {
            SharedRolesCell.textContent = 'No shared roles';
            SharedRolesCell.classList.add('role-empty');
        } else {
            SharedRoleDetails.forEach(Details => {
                const Role = Details.role;
                const RoleName = Role.role_name || Role.name || 'Role';
                const RoleItem = document.createElement('span');
                RoleItem.className = 'online-shared-role-item';

                const Badge = document.createElement('button');
                Badge.type = 'button';
                Badge.className = 'online-role-badge is-shared';
                Badge.textContent = RoleName;
                Badge.title = 'Shared role';
                Badge.addEventListener('click', () => OpenRoleInfoModal(
                    RoleName,
                    Role.permissions || [],
                    Details.owners,
                    Role.role_id,
                    Role.role_description || ''
                ));

                const RemoveButton = document.createElement('button');
                RemoveButton.type = 'button';
                RemoveButton.className = 'online-role-remove button-secondary';
                RemoveButton.textContent = '×';
                RemoveButton.disabled = !Role.role_id;
                RemoveButton.title = `Remove ${RoleName} from everyone`;
                RemoveButton.setAttribute('aria-label', `Remove ${RoleName} from everyone`);
                RemoveButton.addEventListener('click', () => {
                    const Targets = Players.map(Player => ({
                        id: Player.id || Player.user_id,
                        username: Player.username
                    }));
                    OpenRoleRemoveModal(Role.role_id, RoleName, Targets);
                });

                RoleItem.append(Badge, RemoveButton);
                SharedRolesCell.appendChild(RoleItem);
            });
        }

        const SharedActionCell = document.createElement('td');
        SharedActionCell.className = 'online-player-action';
        const AddEveryoneButton = document.createElement('button');
        AddEveryoneButton.type = 'button';
        AddEveryoneButton.className = 'button-secondary online-add-role';
        AddEveryoneButton.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> Add role to everyone';
        AddEveryoneButton.addEventListener('click', () => {
            ActiveRoleTargets = Players.map(Player => ({
                id: Player.id || Player.user_id,
                username: Player.username
            }));
            OnlineRoleTargetId = null;
            OpenAddRoleModal();
        });

        SharedActionCell.appendChild(AddEveryoneButton);
        SharedRow.append(SharedNameCell, SharedRolesCell, SharedActionCell);
        Body.appendChild(SharedRow);
    }

    Players.forEach(Player => {
        const Row = document.createElement('tr');
        const NameCell = document.createElement('td');
        NameCell.className = 'online-player-name';
        const PlayerId = Player.user_id || Player.id;
        const NameButton = document.createElement('button');
        NameButton.type = 'button';
        NameButton.className = 'player-name-copy';
        NameButton.textContent = Player.username || 'Unknown player';
        NameButton.disabled = !PlayerId;
        NameButton.setAttribute('aria-label', PlayerId ? `Copy player ID for ${Player.username}` : 'Player ID unavailable');
        const PlayerIdTooltip = document.createElement('span');
        PlayerIdTooltip.className = 'player-id-tooltip';
        PlayerIdTooltip.textContent = PlayerId ? `ID: ${PlayerId}` : 'Player ID unavailable';
        NameButton.appendChild(PlayerIdTooltip);
        const PositionPlayerIdTooltip = () => {
            const Anchor = NameButton.getBoundingClientRect();
            const TooltipBounds = PlayerIdTooltip.getBoundingClientRect();
            let Top = Anchor.top - TooltipBounds.height - 8;
            PlayerIdTooltip.classList.toggle('is-below', Top < 8);
            if (Top < 8) Top = Anchor.bottom + 8;
            const Left = Math.max(
                TooltipBounds.width / 2 + 8,
                Math.min(Anchor.left + Anchor.width / 2, window.innerWidth - TooltipBounds.width / 2 - 8)
            );
            PlayerIdTooltip.style.top = `${Top}px`;
            PlayerIdTooltip.style.left = `${Left}px`;
        };
        NameButton.addEventListener('mouseenter', PositionPlayerIdTooltip);
        NameButton.addEventListener('focus', PositionPlayerIdTooltip);
        NameButton.addEventListener('click', async () => {
            if (!PlayerId) return;
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(String(PlayerId));
                } else {
                    const CopyInput = document.createElement('textarea');
                    CopyInput.value = String(PlayerId);
                    CopyInput.style.position = 'fixed';
                    CopyInput.style.opacity = '0';
                    document.body.appendChild(CopyInput);
                    CopyInput.select();
                    document.execCommand('copy');
                    CopyInput.remove();
                }
                PlayerIdTooltip.textContent = 'Copied!';
                setTimeout(() => { PlayerIdTooltip.textContent = `ID: ${PlayerId}`; }, 1200);
            } catch (Error) {
                console.error('Could not copy player ID:', Error);
                PlayerIdTooltip.textContent = 'Copy failed';
                setTimeout(() => { PlayerIdTooltip.textContent = `ID: ${PlayerId}`; }, 1200);
            }
        });
        NameCell.appendChild(NameButton);

        const RolesCell = document.createElement('td');
        RolesCell.className = 'online-player-roles';
        const PlayerRoles = (Player.roles || []).filter(Role => {
            if (!IsGroup) return true;
            const RoleId = Role.role_id || Role.name || Role.role_name;
            const Details = RoleDetails.get(RoleId);
            return !Details || Details.owners.length < Players.length;
        });
        if (Player.notFound) {
            RolesCell.textContent = 'Player not found';
            RolesCell.classList.add('role-empty');
        } else if (Player.rolesUnavailable) {
            RolesCell.textContent = 'Roles unavailable';
            RolesCell.classList.add('role-empty');
        } else if (PlayerRoles.length === 0) {
            RolesCell.textContent = IsGroup ? 'No exclusive roles' : 'No roles';
            RolesCell.classList.add('role-empty');
        } else {
            PlayerRoles.forEach(Role => {
                const RoleId = Role.role_id || Role.name || Role.role_name;
                const Details = RoleDetails.get(RoleId);
                if (!Details) return;
                const IsShared = IsGroup && Details.owners.length === Players.length;
                const Badge = document.createElement('button');
                Badge.type = 'button';
                Badge.className = `online-role-badge${IsGroup ? (IsShared ? ' is-shared' : ' is-exclusive') : ''}`;
                const RoleName = Role.role_name || Role.name || 'Role';
                Badge.textContent = RoleName;
                if (IsGroup) Badge.title = IsShared ? 'Shared role' : 'Exclusive role';
                Badge.addEventListener('click', () => OpenRoleInfoModal(
                    RoleName,
                    Role.permissions || Details.role.permissions || [],
                    Details.owners,
                    Role.role_id,
                    Role.role_description || Details.role.role_description || ''
                ));
                if (IsGroup) {
                    const RoleItem = document.createElement('span');
                    RoleItem.className = 'online-shared-role-item';
                    const RemoveButton = document.createElement('button');
                    RemoveButton.type = 'button';
                    RemoveButton.className = 'online-role-remove button-secondary';
                    RemoveButton.textContent = '×';
                    RemoveButton.disabled = !Role.role_id;
                    RemoveButton.title = `Remove ${RoleName} from ${Player.username}`;
                    RemoveButton.setAttribute('aria-label', `Remove ${RoleName} from ${Player.username}`);
                    RemoveButton.addEventListener('click', () => OpenRoleRemoveModal(
                        Role.role_id,
                        RoleName,
                        [{ id: Player.id || Player.user_id, username: Player.username }]
                    ));
                    RoleItem.append(Badge, RemoveButton);
                    RolesCell.appendChild(RoleItem);
                } else {
                    RolesCell.appendChild(Badge);
                }
            });
        }

        const ActionCell = document.createElement('td');
        ActionCell.className = 'online-player-action';
        const AddButton = document.createElement('button');
        AddButton.type = 'button';
        AddButton.className = 'button-secondary online-add-role';
        AddButton.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> Add role';
        AddButton.setAttribute('aria-label', `Add role to ${Player.username}`);
        AddButton.disabled = Boolean(Player.notFound);
        AddButton.addEventListener('click', () => OpenTablePlayerRoleModal(Player));
        ActionCell.appendChild(AddButton);
        Row.append(NameCell, RolesCell, ActionCell);
        Body.appendChild(Row);
    });
}

async function RefreshOnlinePlayers() {
    const Status = document.getElementById('online-players-status');
    const Body = document.getElementById('online-players-body');
    if (!Status || !Body || CurrentPlayersViewMode !== 'online') return;

    const RequestGeneration = ++OnlinePlayersRefreshGeneration;
    CurrentSelectionIsGroup = false;
    UpdateMissingPlayerNames([]);
    BeginRequest();
    SetOnlinePlayersStatus('Checking who is online…');
    Status.classList.remove('is-error');
    try {
        const Response = await fetch('/api/players/online');
        const Data = await Response.json();
        if (!Response.ok) throw new Error(Data.error || 'Failed to fetch players');
        if (RequestGeneration !== OnlinePlayersRefreshGeneration || CurrentPlayersViewMode !== 'online') return;

        const Now = Date.now();
        const OnlinePlayers = (Data.items || []).filter(Player => {
            const LastLogin = Date.parse(Player.last_login || '');
            const Age = Now - LastLogin;
            return Number.isFinite(LastLogin) && Age >= -60_000 && Age <= OnlinePlayerWindowMs;
        });

        const PlayersWithRoles = await Promise.all(OnlinePlayers.map(async Player => {
            if (Array.isArray(Player.roles)) return { ...Player, roles: Player.roles };
            try {
                const RolesResponse = await fetch(`/api/players/${encodeURIComponent(Player.user_id)}/roles`);
                const RolesData = await RolesResponse.json();
                if (!RolesResponse.ok) throw new Error(RolesData.error || 'Failed to fetch roles');
                return { ...Player, roles: Array.isArray(RolesData.roles) ? RolesData.roles : [] };
            } catch (Error) {
                console.error(`Failed to load roles for ${Player.username}:`, Error);
                return { ...Player, roles: [], rolesUnavailable: true };
            }
        }));
        if (RequestGeneration !== OnlinePlayersRefreshGeneration || CurrentPlayersViewMode !== 'online') return;
        RenderPlayersTable(PlayersWithRoles);

        Status.textContent = '';
        Status.classList.toggle('is-empty', OnlinePlayers.length === 0);
    } catch (Error) {
        console.error('Online player list failed:', Error);
        if (RequestGeneration !== OnlinePlayersRefreshGeneration || CurrentPlayersViewMode !== 'online') return;
        Body.innerHTML = '';
        Status.textContent = Error.message || 'Failed to load online players.';
        Status.classList.add('is-error');
    } finally {
        EndRequest();
    }
}

function OpenTablePlayerRoleModal(Player) {
    const Id = Player.id || Player.user_id;
    ActiveRoleTargets = [{ id: Id, username: Player.username }];
    OnlineRoleTargetId = CurrentPlayersViewMode === 'online' ? Id : null;
    OpenAddRoleModal();
}

function CreatePlayerRoleTag(RoleData, ShowOwners) {
    let Tag = document.createElement('div');
    Tag.className = 'role-tag player-role-tag';

    let RoleContent = document.createElement('div');
    RoleContent.className = 'player-role-content';
    let NameSpan = document.createElement('strong');
    NameSpan.textContent = RoleData.role.role_name;
    RoleContent.appendChild(NameSpan);

    if (ShowOwners) {
        let Owners = document.createElement('span');
        Owners.className = 'role-owners';
        Owners.textContent = RoleData.owners.join(', ');
        RoleContent.appendChild(Owners);
    }

    let RoleActions = document.createElement('div');
    RoleActions.className = 'role-actions';

    let InfoBtn = document.createElement('button');
    InfoBtn.className = 'role-info';
    InfoBtn.type = 'button';
    InfoBtn.title = `View ${RoleData.role.role_name} permissions`;
    InfoBtn.setAttribute('aria-label', `View ${RoleData.role.role_name} permissions`);
    InfoBtn.innerHTML = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i>';
    InfoBtn.onclick = function(Event) {
        Event.stopPropagation();
        OpenRoleInfoModal(RoleData.role.role_name, RoleData.role.permissions, [], RoleData.role.role_id, RoleData.role.role_description);
    };

    let RemoveBtn = document.createElement('button');
    RemoveBtn.className = 'role-remove';
    RemoveBtn.type = 'button';
    RemoveBtn.setAttribute('aria-label', `Remove ${RoleData.role.role_name}`);
    RemoveBtn.innerHTML = '&times;';
    RemoveBtn.onclick = function(Event) {
        Event.stopPropagation();
        OpenRoleRemoveModal(RoleData.role.role_id, RoleData.role.role_name);
    };

    let Tooltip = document.createElement('div');
    Tooltip.className = 'tooltip-text';
    let Permissions = Array.isArray(RoleData.role.permissions) ? RoleData.role.permissions : [];
    let VisiblePermissions = Permissions.slice(0, 5);
    if (Permissions.length > 5) VisiblePermissions.push('+' + (Permissions.length - 5) + ' more...');
    Tooltip.textContent = VisiblePermissions.join('\n') || 'No permissions assigned.';

    RoleActions.append(InfoBtn, RemoveBtn);
    Tag.append(RoleContent, RoleActions, Tooltip);
    return Tag;
}

function RenderPlayerRoles(RoleMap) {
    let Container = document.getElementById('player-roles-container');
    Container.innerHTML = '';

    let IsGroup = ActiveRoleTargets.length > 1;
    let SharedRoles = [...RoleMap.values()].filter(RoleData => RoleData.owners.length === ActiveRoleTargets.length);
    let ExclusiveRoles = [...RoleMap.values()].filter(RoleData => RoleData.owners.length < ActiveRoleTargets.length);

    if (RoleMap.size === 0) {
        Container.textContent = 'No roles assigned.';
        return;
    }

    let Sections = IsGroup ? [
        { title: 'Shared roles', roles: SharedRoles, showOwners: false, empty: 'No roles shared by everyone.' },
        { title: 'Exclusive roles', roles: ExclusiveRoles, showOwners: true, empty: 'No exclusive roles.' }
    ] : [
        { title: 'Roles', roles: SharedRoles, showOwners: false, empty: 'No roles assigned.' }
    ];

    Sections.forEach(Section => {
        let SectionElement = document.createElement('section');
        SectionElement.className = 'player-role-section';
        let Heading = document.createElement('h4');
        Heading.textContent = Section.title;
        SectionElement.appendChild(Heading);

        let RoleList = document.createElement('div');
        RoleList.className = 'roles-container';
        if (Section.roles.length === 0) {
            let Empty = document.createElement('p');
            Empty.className = 'role-empty';
            Empty.textContent = Section.empty;
            RoleList.appendChild(Empty);
        } else {
            Section.roles.forEach(RoleData => RoleList.appendChild(CreatePlayerRoleTag(RoleData, Section.showOwners)));
        }
        SectionElement.appendChild(RoleList);
        Container.appendChild(SectionElement);
    });
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
        RoleName.className = 'role-option-name';
        RoleName.textContent = Role.role_name;
        Div.appendChild(RoleName);

        let Permissions = document.createElement('ul');
        Permissions.className = 'role-permissions';
        let RolePermissions = Array.isArray(Role.permissions) ? Role.permissions : [];
        if (RolePermissions.length === 0) {
            let Permission = document.createElement('li');
            Permission.textContent = 'No permissions assigned.';
            Permission.className = 'role-permission-empty';
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

function CreateRoleUpdateProgress(Action) {
    let ProgressNode = document.createElement('div');
    ProgressNode.className = 'role-update-progress';
    ProgressNode.innerHTML = `
        <div class="role-update-progress-header">
            <strong class="role-update-action">${Action}</strong>
            <span class="role-update-count"></span>
        </div>
        <div class="role-update-current"></div>
    `;
    return ProgressNode;
}

function UpdateRoleUpdateProgress(ProgressNode, Action, Index, Total, Username) {
    ProgressNode.querySelector('.role-update-action').textContent = Action;
    ProgressNode.querySelector('.role-update-count').textContent = `${Index} of ${Total}`;
    ProgressNode.querySelector('.role-update-current').textContent = Username;
}

function OpenRoleRemoveModal(RoleId, RoleName, Targets = ActiveRoleTargets) {
    PendingRoleRemoval = RoleId;
    PendingRoleRemovalTargets = [...Targets];
    const TargetNames = PendingRoleRemovalTargets.map(Target => Target.username).filter(Boolean);
    const TargetDescription = TargetNames.length === 1
        ? `${TargetNames[0]}`
        : `${TargetNames.length} selected players`;
    document.getElementById('role-remove-message').textContent = `Remove ${RoleName} from ${TargetDescription}?`;
    document.getElementById('role-remove-modal').classList.add('active');
}

function CloseRoleRemoveModal() {
    document.getElementById('role-remove-modal').classList.remove('active');
    PendingRoleRemoval = null;
    PendingRoleRemovalTargets = [];
}

function HandleRoleRemoveBackdropClick(Event) {
    if (Event.target && Event.target.id === 'role-remove-modal') {
        CloseRoleRemoveModal();
    }
}

function OpenRoleInfoModal(RoleName, Permissions, Players = [], RoleId = null, Description = '') {
    let PermissionsContainer = document.getElementById('role-info-permissions');
    PermissionsContainer.innerHTML = '';
    let PermissionList = Array.isArray(Permissions) ? Permissions : [];
    let MembersContainer = document.getElementById('role-info-members');
    MembersContainer.innerHTML = '';

    if (PermissionList.length === 0) {
        let Empty = document.createElement('span');
        Empty.className = 'role-empty';
        Empty.textContent = 'No permissions assigned.';
        PermissionsContainer.appendChild(Empty);
    } else {
        PermissionList.forEach(PermissionValue => {
            let Permission = document.createElement('span');
            Permission.className = 'role-permission-chip';
            Permission.textContent = String(PermissionValue);
            PermissionsContainer.appendChild(Permission);
        });
    }

    const UniquePlayers = [...new Map(Players
        .filter(Player => Player && (typeof Player === 'string' || Player.username))
        .map(Player => {
            const Member = typeof Player === 'string' ? { username: Player } : Player;
            return [Member.id || Member.username, Member];
        })).values()];
    if (UniquePlayers.length === 0) {
        const Empty = document.createElement('span');
        Empty.className = 'role-empty';
        Empty.textContent = 'No players with this role in the current list.';
        MembersContainer.appendChild(Empty);
    } else {
        UniquePlayers.forEach(Player => {
            const Member = document.createElement('div');
            Member.className = 'role-member-row';
            const Name = document.createElement('span');
            Name.className = 'role-member-name';
            Name.textContent = Player.username;
            Member.appendChild(Name);
            if (RoleId && Player.id) {
                const RemoveButton = document.createElement('button');
                RemoveButton.type = 'button';
                RemoveButton.className = 'role-member-remove';
                RemoveButton.textContent = '×';
                RemoveButton.setAttribute('aria-label', `Remove ${RoleName} from ${Player.username}`);
                RemoveButton.addEventListener('click', () => {
                    CloseRoleInfoModal();
                    OpenRoleRemoveModal(RoleId, RoleName, [{ id: Player.id, username: Player.username }]);
                });
                Member.appendChild(RemoveButton);
            }
            MembersContainer.appendChild(Member);
        });
    }

    document.getElementById('role-info-title').textContent = `${RoleName} details`;
    const DescriptionElement = document.getElementById('role-info-description');
    DescriptionElement.textContent = Description || 'No description provided.';
    DescriptionElement.classList.toggle('is-empty', !Description);
    document.getElementById('role-info-modal').classList.add('active');
}

function CloseRoleInfoModal() {
    document.getElementById('role-info-modal').classList.remove('active');
}

function HandleRoleInfoBackdropClick(Event) {
    if (Event.target && Event.target.id === 'role-info-modal') {
        CloseRoleInfoModal();
    }
}

async function ConfirmRoleRemove() {
    if (!PendingRoleRemoval) return;
    let RoleId = PendingRoleRemoval;
    ActiveRoleTargets = [...PendingRoleRemovalTargets];
    CloseRoleRemoveModal();
    await RemovePlayerRole(RoleId);
}

async function RemovePlayerRole(RoleId) {
    BeginRequest();
    const Status = document.getElementById('online-players-status');

    try {
        let errors = [];
        for (let i = 0; i < ActiveRoleTargets.length; i++) {
            let Target = ActiveRoleTargets[i];
            Status.textContent = `${i + 1}/${ActiveRoleTargets.length} ${Target.username}`;
            
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
        
        if (CurrentPlayersViewMode === 'online') {
            await RefreshOnlinePlayers();
        } else {
            ActiveRoleTargets = [...CurrentSelectionTargets];
            await LoadPlayerRoles();
        }
    } finally {
        EndRequest();
    }
}

async function AddPlayerRole(RoleId) {
    CloseAddRoleModal();
    BeginRequest();
    const Status = document.getElementById('online-players-status');

    try {
        let errors = [];
        for (let i = 0; i < ActiveRoleTargets.length; i++) {
            let Target = ActiveRoleTargets[i];
            Status.textContent = `${i + 1}/${ActiveRoleTargets.length} ${Target.username}`;
            
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
        
        if (CurrentPlayersViewMode === 'online') {
            OnlineRoleTargetId = null;
            await RefreshOnlinePlayers();
        } else {
            ActiveRoleTargets = [...CurrentSelectionTargets];
            await LoadPlayerRoles();
        }
    } finally {
        EndRequest();
    }
}

async function RefreshFleetConfig() {
    BeginRequest();
    try {
        let Res = await fetch('/api/fleet/config');
        let Data = await Res.json();
        if (!Res.ok) throw new Error(Data.error || 'Failed to fetch fleet config');
        CurrentFleetConfig = Data;
        RenderFleetSettings();
    } catch (Error) {
        console.error('Fleet config load failed:', Error);
        alert(Error.message || 'Failed to fetch fleet config');
    } finally {
        EndRequest();
    }
}

function RenderFleetSettings() {
    let Container = document.getElementById('fleet-settings-container');
    if (!Container) return;

    let IsAllowlistOnly = Object.prototype.hasOwnProperty.call(CurrentFleetConfig, 'is_whitelist')
        ? CurrentFleetConfig.is_whitelist === true || CurrentFleetConfig.is_whitelist === 'true'
        : true;

    Container.innerHTML = `
        <div class="control-row">
            <span>Allowlist-only Fleet</span>
            <label class="switch">
                <input type="checkbox" id="fleet-allowlist-toggle" ${IsAllowlistOnly ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        </div>
    `;

    Container.querySelector('#fleet-allowlist-toggle').addEventListener('change', (Event) => {
        let NewValue = Event.target.checked;
        if (!NewValue) {
            OpenConfirmModal('Disable fleet whitelist?', 'Only do this if you want players to join Creator Events. This will turn off the fleet being allowlist-only (whitelist-only). Continue?', async () => {
                await UpdateFleetAllowlist(false);
            });
            Event.target.checked = true;
            return;
        }
        UpdateFleetAllowlist(true);
    });
}

async function UpdateFleetAllowlist(NewValue) {
    BeginRequest();
    try {
        let Res = await fetch('/api/fleet/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fleetUpdates: { is_whitelist: NewValue } })
        });
        let Data = await Res.json().catch(() => ({}));
        if (!Res.ok) throw new Error(Data.error || `Failed to save fleet config (${Res.status})`);
        CurrentFleetConfig.is_whitelist = NewValue;
        RenderFleetSettings();
    } catch (Error) {
        console.error('Fleet config save failed:', Error);
        alert(Error.message || 'Failed to save fleet config');
        RenderFleetSettings();
    } finally {
        EndRequest();
    }
}

async function SelectStation(Id, Name, Region) {
    if (StationConfigEditing) SetStationConfigEditorMode(false);
    CurrentStationId = Id;
    document.getElementById('station-name-display').textContent = Name;
    document.getElementById('station-region-display').textContent = GetRegionLabel(Region);
    SetMainTab('stations');
    
    await RefreshConfig();
}

function SetMainTab(TabName) {
    const StationView = document.getElementById('view-stations');
    const StationDetailView = document.getElementById('view-station');
    const GroupsView = document.getElementById('view-groups');
    const ServerView = document.getElementById('view-server');

    if (TabName === 'server') {
        RefreshFleetConfig();
        CurrentPlayersViewMode = 'online';
        RefreshOnlinePlayers();
        if (!OnlinePlayersRefreshTimer) {
            OnlinePlayersRefreshTimer = setInterval(() => {
                if (document.getElementById('view-server')?.classList.contains('active')) RefreshOnlinePlayers();
            }, 30_000);
        }
    } else if (OnlinePlayersRefreshTimer) {
        clearInterval(OnlinePlayersRefreshTimer);
        OnlinePlayersRefreshTimer = null;
    }

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
    if (StationConfigEditing) SetStationConfigEditorMode(false);
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
    SetStationPageLoading(true);
    try {
        let Res = await fetch(`/api/stations/${CurrentStationId}/config`);
        let Data = await Res.json();

        if (!Res.ok) throw new Error(Data.error || 'Failed to fetch station config');
        CurrentFullConfig = Data.fullConfig || {};
        CurrentStationConfig = Data.stationConfig || {};
        CurrentStationConfigKeys = Object.keys(CurrentStationConfig);

        RenderRawConfig();
        RenderControls();
        RenderWeeklySelector();
        if (StationConfigEditing) {
            StationConfigEditorOriginal = JSON.stringify(CurrentStationConfig, null, 2);
            document.getElementById('station-config-input').value = StationConfigEditorOriginal;
            ValidateStationConfigEditor();
        }
    } finally {
        SetStationPageLoading(false);
        EndRequest();
    }
}

function SetStationConfigEditorStatus(State, Message) {
    const Status = document.getElementById('station-config-status');
    Status.dataset.state = State;
    Status.textContent = Message;
}

function ValidateStationConfigEditor() {
    const Input = document.getElementById('station-config-input');
    try {
        const Parsed = JSON.parse(Input.value);
        if (!Parsed || typeof Parsed !== 'object' || Array.isArray(Parsed)) {
            throw new Error('Not a JSOn');
        }
        SetStationConfigEditorStatus('valid', 'Correct JSON!');
        return Parsed;
    } catch (Error) {
        SetStationConfigEditorStatus('invalid', `JSON error: ${Error.message}`);
        return null;
    }
}

function SetStationConfigEditorMode(IsEditing) {
    StationConfigEditing = IsEditing;
    const Topbar = document.querySelector('#view-station .topbar');
    const Controls = document.querySelector('#view-station .controls-panel');
    const Divider = document.getElementById('layout-divider');
    [Topbar, Controls, Divider].forEach(Element => {
        if (Element) Element.inert = IsEditing;
    });
    document.getElementById('raw-config').classList.toggle('hidden', IsEditing);
    document.getElementById('station-config-editor').classList.toggle('hidden', !IsEditing);
    document.getElementById('config-edit-button').classList.toggle('hidden', IsEditing);
    document.getElementById('config-editor-actions').classList.toggle('hidden', !IsEditing);
    document.getElementById('config-mode-label').textContent = IsEditing ? 'Editing station config' : 'Read-only';
}

function OpenStationConfigEditor() {
    StationConfigEditorOriginal = JSON.stringify(CurrentStationConfig || {}, null, 2);
    const Input = document.getElementById('station-config-input');
    Input.value = StationConfigEditorOriginal;
    Input.oninput = ValidateStationConfigEditor;
    SetStationConfigEditorMode(true);
    ValidateStationConfigEditor();
    Input.focus();
}

function CloseStationConfigEditor() {
    const Input = document.getElementById('station-config-input');
    if (Input.value !== StationConfigEditorOriginal) {
        OpenStationConfigDiscardModal('Discard unsaved station config changes?', () => {
            SetStationConfigEditorMode(false);
            RenderRawConfig();
        });
        return;
    }
    SetStationConfigEditorMode(false);
    RenderRawConfig();
}

async function RefreshStationConfigEditor() {
    const Input = document.getElementById('station-config-input');
    if (Input.value !== StationConfigEditorOriginal) {
        OpenStationConfigDiscardModal('Discard unsaved changes and refresh station config?', RefreshConfig);
        return;
    }
    await RefreshConfig();
}

let PendingStationConfigDiscardAction = null;

function OpenStationConfigDiscardModal(Message, Action) {
    const Modal = document.getElementById('station-config-discard-modal');
    document.getElementById('station-config-discard-message').textContent = Message;
    PendingStationConfigDiscardAction = Action;
    Modal.classList.add('active');
    Modal.setAttribute('aria-hidden', 'false');
    document.getElementById('station-config-discard-cancel').focus();
}

function CloseStationConfigDiscardModal() {
    const Modal = document.getElementById('station-config-discard-modal');
    Modal.classList.remove('active');
    Modal.setAttribute('aria-hidden', 'true');
    PendingStationConfigDiscardAction = null;
}

async function ConfirmStationConfigDiscard() {
    const Action = PendingStationConfigDiscardAction;
    CloseStationConfigDiscardModal();
    if (typeof Action === 'function') await Action();
}

function HandleStationConfigDiscardBackdropClick(Event) {
    if (Event.target && Event.target.id === 'station-config-discard-modal') {
        CloseStationConfigDiscardModal();
    }
}

async function SaveStationConfigEditor() {
    const StationConfig = ValidateStationConfigEditor();
    if (!StationConfig) return;
    const EditorButtons = [...document.querySelectorAll('#config-editor-actions button')];
    const EditorInput = document.getElementById('station-config-input');
    EditorButtons.forEach(Button => { Button.disabled = true; });
    EditorInput.disabled = true;
    SetStationConfigEditorStatus('saving', 'Checking and saving station config…');
    BeginRequest();
    try {
        const Response = await fetch(`/api/stations/${encodeURIComponent(CurrentStationId)}/config/edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stationConfig: StationConfig })
        });
        const Data = await Response.json().catch(() => ({}));
        if (!Response.ok) throw new Error(Data.details || Data.error || `Save failed (${Response.status})`);
        await RefreshConfig();
        SetStationConfigEditorMode(false);
        RenderRawConfig();
    } catch (Error) {
        SetStationConfigEditorStatus('invalid', Error.message || 'Failed to save station config.');
    } finally {
        EditorButtons.forEach(Button => { Button.disabled = false; });
        EditorInput.disabled = false;
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
    let OpenStates = [...TogglesContainer.querySelectorAll('.settings-group')].map(GroupDetails => GroupDetails.open);
    TogglesContainer.innerHTML = '';

    SettingsGroups.forEach((Group, Index) => {
        let GroupDetails = document.createElement('details');
        GroupDetails.className = 'settings-group';
        GroupDetails.open = OpenStates[Index] ?? (Group.defaultOpen || Index === 0);

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

    GmContainer.appendChild(CreateGamemodeRow(Gamemodes.Tag, IsTagLoaded, () => ToggleTag(!IsTagLoaded)));
    GmContainer.appendChild(CreateGamemodeRow(Gamemodes.Koth, IsKothLoaded, () => ToggleKoth(!IsKothLoaded)));

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
        if (GmData === Gamemodes.Koth) {
            let NeedsFix = 
                GetBooleanSettingValue({ key: "config.player.enableThrusters", default: true }) ||
                GetBooleanSettingValue({ key: "config.player.enableHeartBall", default: true }) ||
                !GetBooleanSettingValue({ key: "config.player.tackleEnemyTeamOnly", default: false }) ||
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
        [Key]: NewValue
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
                { label: "Allow Restarts", key: "loadedgamemodes.tkb_prime.modulestate.dashboardconfigoverrides.ballowrestarts", default: true },
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
            title: "Driftball Plaza West",
            toggles: [
                { label: "Kick Losing Team", key: "loadedgamemodes.tkb_plazawest.modulestate.dashboardconfigoverrides.bkicklosingteam", default: true },
                { label: "Allow Restarts", key: "loadedgamemodes.tkb_plazawest.modulestate.dashboardconfigoverrides.ballowrestarts", default: true },
                { label: "Closed Team VOIP", key: "loadedgamemodes.tkb_plazawest.modulestate.dashboardconfigoverrides.buseclosedteamvoip", default: false },
                { label: "Whitelist Team 0", key: "loadedgamemodes.tkb_plazawest.modulestate.dashboardconfigoverrides.buseteam0whitelist", default: false, whitelistKey: "loadedgamemodes.tkb_plazawest.modulestate.dashboardconfigoverrides.team0whitelist", whitelistTitle: "Manage Team 0 Whitelist" },
                { label: "Whitelist Team 1", key: "loadedgamemodes.tkb_plazawest.modulestate.dashboardconfigoverrides.buseteam1whitelist", default: false, whitelistKey: "loadedgamemodes.tkb_plazawest.modulestate.dashboardconfigoverrides.team1whitelist", whitelistTitle: "Manage Team 1 Whitelist" }
            ],
            numbers: [
                { label: "Max Team 0 Size", key: "loadedgamemodes.tkb_plazawest.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.0", default: 3 },
                { label: "Max Team 1 Size", key: "loadedgamemodes.tkb_plazawest.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.1", default: 3 }
            ]
        },
        {
            title: "Driftball Plaza East",
            toggles: [
                { label: "Kick Losing Team", key: "loadedgamemodes.tkb_plazaeast.modulestate.dashboardconfigoverrides.bkicklosingteam", default: true },
                { label: "Allow Restarts", key: "loadedgamemodes.tkb_plazaeast.modulestate.dashboardconfigoverrides.ballowrestarts", default: true },
                { label: "Closed Team VOIP", key: "loadedgamemodes.tkb_plazaeast.modulestate.dashboardconfigoverrides.buseclosedteamvoip", default: false },
                { label: "Whitelist Team 0", key: "loadedgamemodes.tkb_plazaeast.modulestate.dashboardconfigoverrides.buseteam0whitelist", default: false, whitelistKey: "loadedgamemodes.tkb_plazaeast.modulestate.dashboardconfigoverrides.team0whitelist", whitelistTitle: "Manage Team 0 Whitelist" },
                { label: "Whitelist Team 1", key: "loadedgamemodes.tkb_plazaeast.modulestate.dashboardconfigoverrides.buseteam1whitelist", default: false, whitelistKey: "loadedgamemodes.tkb_plazaeast.modulestate.dashboardconfigoverrides.team1whitelist", whitelistTitle: "Manage Team 1 Whitelist" }
            ],
            numbers: [
                { label: "Max Team 0 Size", key: "loadedgamemodes.tkb_plazaeast.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.0", default: 3 },
                { label: "Max Team 1 Size", key: "loadedgamemodes.tkb_plazaeast.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.1", default: 3 }
            ]
        },
        {
            title: "Driftball 4v4 West Front",
            toggles: [
                { label: "Kick Losing Team", key: "loadedgamemodes.driftball west 01.modulestate.dashboardconfigoverrides.bkicklosingteam", default: true },
                { label: "Allow Restarts", key: "loadedgamemodes.driftball west 01.modulestate.dashboardconfigoverrides.ballowrestarts", default: true },
                { label: "Closed Team VOIP", key: "loadedgamemodes.driftball west 01.modulestate.dashboardconfigoverrides.buseclosedteamvoip", default: false },
                { label: "Whitelist Team 0", key: "loadedgamemodes.driftball west 01.modulestate.dashboardconfigoverrides.buseteam0whitelist", default: false, whitelistKey: "loadedgamemodes.driftball west 01.modulestate.dashboardconfigoverrides.team0whitelist", whitelistTitle: "Manage Team 0 Whitelist" },
                { label: "Whitelist Team 1", key: "loadedgamemodes.driftball west 01.modulestate.dashboardconfigoverrides.buseteam1whitelist", default: false, whitelistKey: "loadedgamemodes.driftball west 01.modulestate.dashboardconfigoverrides.team1whitelist", whitelistTitle: "Manage Team 1 Whitelist" }
            ],
            numbers: [
                { label: "Max Team 0 Size", key: "loadedgamemodes.driftball west 01.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.0", default: 4 },
                { label: "Max Team 1 Size", key: "loadedgamemodes.driftball west 01.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.1", default: 4 }
            ]
        },
        {
            title: "Driftball 4v4 East Front",
            toggles: [
                { label: "Kick Losing Team", key: "loadedgamemodes.driftball east 01.modulestate.dashboardconfigoverrides.bkicklosingteam", default: true },
                { label: "Allow Restarts", key: "loadedgamemodes.driftball east 01.modulestate.dashboardconfigoverrides.ballowrestarts", default: true },
                { label: "Closed Team VOIP", key: "loadedgamemodes.driftball east 01.modulestate.dashboardconfigoverrides.buseclosedteamvoip", default: false },
                { label: "Whitelist Team 0", key: "loadedgamemodes.driftball east 01.modulestate.dashboardconfigoverrides.buseteam0whitelist", default: false, whitelistKey: "loadedgamemodes.driftball east 01.modulestate.dashboardconfigoverrides.team0whitelist", whitelistTitle: "Manage Team 0 Whitelist" },
                { label: "Whitelist Team 1", key: "loadedgamemodes.driftball east 01.modulestate.dashboardconfigoverrides.buseteam1whitelist", default: false, whitelistKey: "loadedgamemodes.driftball east 01.modulestate.dashboardconfigoverrides.team1whitelist", whitelistTitle: "Manage Team 1 Whitelist" }
            ],
            numbers: [
                { label: "Max Team 0 Size", key: "loadedgamemodes.driftball east 01.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.0", default: 4 },
                { label: "Max Team 1 Size", key: "loadedgamemodes.driftball east 01.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.1", default: 4 }
            ]
        },
        {
            title: "Z-Drift Beta (Front)",
            toggles: [
                { label: "Kick Losing Team", key: "loadedgamemodes.czg_zdrift_beta.modulestate.dashboardconfigoverrides.bkicklosingteam", default: true },
                { label: "Use Whitelist", key: "loadedgamemodes.czg_zdrift_beta.modulestate.dashboardconfigoverrides.busewhitelist", default: false, customWhitelist: true, moduleId: "czg_zdrift_beta" }
            ],
            numbers: [
                { label: "Max Team 0 Size", key: "loadedgamemodes.czg_zdrift_beta.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.0", default: 4 },
                { label: "Max Team 1 Size", key: "loadedgamemodes.czg_zdrift_beta.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.1", default: 4 }
            ]
        },
        {
            title: "Z-Drift Alpha",
            toggles: [
                { label: "Kick Losing Team", key: "loadedgamemodes.czg_zdrift_alpha.modulestate.dashboardconfigoverrides.bkicklosingteam", default: true },
                { label: "Use Whitelist", key: "loadedgamemodes.czg_zdrift_alpha.modulestate.dashboardconfigoverrides.busewhitelist", default: false, customWhitelist: true, moduleId: "czg_zdrift_alpha" }
            ],
            numbers: [
                { label: "Max Team 0 Size", key: "loadedgamemodes.czg_zdrift_alpha.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.0", default: 4 },
                { label: "Max Team 1 Size", key: "loadedgamemodes.czg_zdrift_alpha.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.1", default: 4 }
            ]
        },
        {
            title: "Z-Drift Gamma",
            toggles: [
                { label: "Kick Losing Team", key: "loadedgamemodes.czg_zdrift_gamma.modulestate.dashboardconfigoverrides.bkicklosingteam", default: true },
                { label: "Use Whitelist", key: "loadedgamemodes.czg_zdrift_gamma.modulestate.dashboardconfigoverrides.busewhitelist", default: false, customWhitelist: true, moduleId: "czg_zdrift_gamma" }
            ],
            numbers: [
                { label: "Max Team 0 Size", key: "loadedgamemodes.czg_zdrift_gamma.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.0", default: 4 },
                { label: "Max Team 1 Size", key: "loadedgamemodes.czg_zdrift_gamma.modulestate.dashboardconfigoverrides.ticketmanagersettings.maxteamsizes.1", default: 4 }
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
                const WhitelistPrefix = `loadedgamemodes.${Tog.moduleId}.modulestate.dashboardconfigoverrides`;
                BtnHtml = `
                    <button class="button-secondary whitelist-btn" onclick="OpenWhitelistModal('${WhitelistPrefix}.team0whitelist', 'Manage Team 0 whitelist')">Manage Team 0 whitelist</button>
                    <button class="button-secondary whitelist-btn" onclick="OpenWhitelistModal('${WhitelistPrefix}.team1whitelist', 'Manage Team 1 whitelist')">Manage Team 1 whitelist</button>
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
            const Info = document.createElement('div');
            Info.className = 'control-info';
            const Label = document.createElement('span');
            Label.textContent = Num.label;
            Info.appendChild(Label);

            const NumberControl = document.createElement('div');
            NumberControl.className = 'number-input-control';
            const Input = document.createElement('input');
            Input.type = 'number';
            Input.step = '1';
            Input.className = 'number-input';
            Input.value = Val;
            Input.setAttribute('aria-label', Num.label);
            Input.addEventListener('change', () => {
                const NewValue = Number.parseInt(Input.value, 10);
                if (Number.isFinite(NewValue)) {
                    UpdateGenericSetting(Num.key, NewValue);
                } else {
                    Input.value = GetGenericValue(Num.key, Num.default);
                }
            });

            const CreateStepButton = (Text, Direction) => {
                const Button = document.createElement('button');
                Button.type = 'button';
                Button.className = 'number-input-step';
                Button.textContent = Text;
                Button.setAttribute('aria-label', `${Direction < 0 ? 'Decrease' : 'Increase'} ${Num.label}`);
                Button.addEventListener('click', () => {
                    if (Direction < 0) Input.stepDown();
                    else Input.stepUp();
                    Input.dispatchEvent(new Event('change', { bubbles: true }));
                });
                return Button;
            };

            NumberControl.append(CreateStepButton('<', -1), Input, CreateStepButton('>', 1));
            Row.append(Info, NumberControl);
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
    WhitelistSelectedGroups = CustomGroups
        .filter(Group => Group.players.length > 0 && Group.players.every(Player => CurrentPlayers.includes(Player.username)))
        .map(Group => Group.id);
    
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
        let ResultCount = 0;
        if (Data.items && Data.items.length > 0) {
            Data.items.forEach(Player => {
                if (!WhitelistSelectedPlayers.includes(Player.username)) {
                    let Div = document.createElement('div');
                    Div.className = 'search-result-item';
                    Div.textContent = Player.username;
                    Div.style.cssText = 'padding: 0.5rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--border); font-size: 0.85rem;';
                    Div.onclick = () => AddWhitelistPlayer(Player.username);
                    Results.appendChild(Div);
                    ResultCount += 1;
                }
            });
        }
        Results.classList.toggle('hidden', ResultCount === 0);
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

function Logout() {
    document.cookie.split(";").forEach(function(c) {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
    window.location.href = '/setup.html';
}

const AvailableThemes = ['lime', 'ocean', 'violet', 'sunset'];
const ThemeStorageKey = 'ce-dash-theme';

function ApplyTheme(Theme, Save = false) {
    let SelectedTheme = AvailableThemes.includes(Theme) ? Theme : 'lime';
    document.documentElement.dataset.theme = SelectedTheme;
    document.querySelectorAll('[data-theme-choice]').forEach(Option => {
        Option.setAttribute('aria-pressed', String(Option.dataset.themeChoice === SelectedTheme));
    });
    if (Save) {
        try {
            localStorage.setItem(ThemeStorageKey, SelectedTheme);
        } catch (E) {}
    }
}

try {
    ApplyTheme(localStorage.getItem(ThemeStorageKey) || 'lime');
} catch (E) {
    ApplyTheme('lime');
}

document.addEventListener('DOMContentLoaded', () => {
    let LogoutButton = document.getElementById('logout-button');
    if (LogoutButton) {
        LogoutButton.addEventListener('click', (Event) => {
            Event.stopPropagation();
            Logout();
        });
    }

    let ThemeModal = document.getElementById('theme-picker-modal');
    let ThemeOpenButton = document.getElementById('theme-picker-open');
    let ThemeCloseButton = document.getElementById('theme-picker-close');

    const CloseThemePicker = () => {
        ThemeModal.classList.remove('active');
        ThemeModal.setAttribute('aria-hidden', 'true');
        ThemeOpenButton.focus();
    };

    if (ThemeModal && ThemeOpenButton && ThemeCloseButton) {
        ThemeOpenButton.addEventListener('click', () => {
            ThemeModal.classList.add('active');
            ThemeModal.setAttribute('aria-hidden', 'false');
            ThemeCloseButton.focus();
        });
        ThemeCloseButton.addEventListener('click', CloseThemePicker);
        ThemeModal.addEventListener('click', Event => {
            if (Event.target === ThemeModal) CloseThemePicker();
        });
        ThemeModal.querySelectorAll('[data-theme-choice]').forEach(Option => {
            Option.addEventListener('click', () => ApplyTheme(Option.dataset.themeChoice, true));
        });
        document.addEventListener('keydown', Event => {
            if (Event.key === 'Escape' && ThemeModal.classList.contains('active')) CloseThemePicker();
        });
    }
});

InitializeLayoutDivider();
Init();