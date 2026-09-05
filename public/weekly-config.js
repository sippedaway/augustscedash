const SpawnLocationOptions = [
    {
        id: 'club-district',
        label: 'Club District',
        override: false,
        stationConfig: {
            'config.spawnPointSettings.overrideSpawnPoint': false
        }
    },
    {
        id: 'driftball-district',
        label: 'Driftball District',
        override: true,
        stationConfig: {
            'config.spawnPointSettings.overrideSpawnPoint': true,
            'config.spawnPointSettings.overriddenSpawnLocationX': 0,
            'config.spawnPointSettings.overriddenSpawnLocationY': -2433.689,
            'config.spawnPointSettings.overriddenSpawnLocationZ': -28569.391,
            'config.spawnPointSettings.overriddenSpawnRotationPitch': 0,
            'config.spawnPointSettings.overriddenSpawnRotationYaw': 90,
            'config.spawnPointSettings.overriddenSpawnRotationRoll': 0
        }
    },
    {
        id: 'driftball-prime',
        label: 'Driftball Prime',
        override: true,
        stationConfig: {
            'config.spawnPointSettings.overrideSpawnPoint': true,
            'config.spawnPointSettings.overriddenSpawnLocationX': 0,
            'config.spawnPointSettings.overriddenSpawnLocationY': 21500.689,
            'config.spawnPointSettings.overriddenSpawnLocationZ': -27500.391,
            'config.spawnPointSettings.overriddenSpawnRotationPitch': 0,
            'config.spawnPointSettings.overriddenSpawnRotationYaw': 90,
            'config.spawnPointSettings.overriddenSpawnRotationRoll': 0
        }
    },
    {
        id: 'parkour-district',
        label: 'Parkour District',
        override: true,
        stationConfig: {
            'config.spawnPointSettings.overrideSpawnPoint': true,
            'config.spawnPointSettings.overriddenSpawnLocationX': -24733.393,
            'config.spawnPointSettings.overriddenSpawnLocationY': -2499.958,
            'config.spawnPointSettings.overriddenSpawnLocationZ': 14297.507,
            'config.spawnPointSettings.overriddenSpawnRotationPitch': 0,
            'config.spawnPointSettings.overriddenSpawnRotationYaw': -270,
            'config.spawnPointSettings.overriddenSpawnRotationRoll': 240
        }
    },
    {
        id: 'creator-games',
        label: 'Creator Games',
        override: true,
        stationConfig: {
            'config.spawnPointSettings.overrideSpawnPoint': true,
            'config.spawnPointSettings.overriddenSpawnLocationX': 0,
            'config.spawnPointSettings.overriddenSpawnLocationY': 1326.341,
            'config.spawnPointSettings.overriddenSpawnLocationZ': 28539.412,
            'config.spawnPointSettings.overriddenSpawnRotationPitch': 0,
            'config.spawnPointSettings.overriddenSpawnRotationYaw': 90,
            'config.spawnPointSettings.overriddenSpawnRotationRoll': 180
        }
    },
    {
        id: 'scraprun',
        label: 'Scraprun',
        override: true,
        stationConfig: {
            'config.spawnPointSettings.overrideSpawnPoint': true,
            'config.spawnPointSettings.overriddenSpawnLocationX': -17045.164,
            'config.spawnPointSettings.overriddenSpawnLocationY': 4772.92,
            'config.spawnPointSettings.overriddenSpawnLocationZ': 29375.637,
            'config.spawnPointSettings.overriddenSpawnRotationPitch': 0,
            'config.spawnPointSettings.overriddenSpawnRotationYaw': 90,
            'config.spawnPointSettings.overriddenSpawnRotationRoll': 210
        }
    },
    {
        id: 'august-recording-spot',
        label: "August's recording spot",
        override: true,
        stationConfig: {
            'config.spawnPointSettings.overrideSpawnPoint': true,
            'config.spawnPointSettings.overriddenSpawnLocationX': 1286.377,
            'config.spawnPointSettings.overriddenSpawnLocationY': 14854.028,
            'config.spawnPointSettings.overriddenSpawnLocationZ': -26832.500,
            'config.spawnPointSettings.overriddenSpawnRotationPitch': 0,
            'config.spawnPointSettings.overriddenSpawnRotationYaw': 2.971,
            'config.spawnPointSettings.overriddenSpawnRotationRoll': 111.554
        }
    }
];

const AllowedSpawnPointPresets = SpawnLocationOptions.map((option) => option.stationConfig);
const AllowedSpawnPointKeys = new Set(
    AllowedSpawnPointPresets.flatMap((preset) => Object.keys(preset))
);

function normalizeSpawnValue(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;
        if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
        return trimmed;
    }
    return value;
}

function matchesAllowedSpawnPreset(candidate) {
    if (!candidate || typeof candidate !== 'object') return false;
    return AllowedSpawnPointPresets.some((preset) => {
        const presetEntries = Object.entries(preset).map(([key, value]) => [key, normalizeSpawnValue(value)]);
        const candidateEntries = Object.entries(candidate).map(([key, value]) => [key, normalizeSpawnValue(value)]);
        if (candidateEntries.length !== presetEntries.length) return false;
        const keysMatch = candidateEntries.every(([key]) => Object.prototype.hasOwnProperty.call(preset, key));
        const valuesMatch = presetEntries.every(([key, value]) => {
            return Object.prototype.hasOwnProperty.call(candidate, key) && normalizeSpawnValue(candidate[key]) === value;
        });
        return keysMatch && valuesMatch;
    });
}

function validateSpawnPointUpdate({ stationUpdates = {}, fleetUpdates = {}, stationDeletes = [], fleetDeletes = [] } = {}) {
    const updateEntries = Object.entries({ ...stationUpdates, ...fleetUpdates })
        .filter(([key]) => key.startsWith('config.spawnPointSettings.'));

    if (updateEntries.length > 0) {
        const invalidKeys = updateEntries.filter(([key]) => !AllowedSpawnPointKeys.has(key));
        if (invalidKeys.length > 0) return false;

        const candidate = Object.fromEntries(updateEntries);
        if (!matchesAllowedSpawnPreset(candidate)) return false;
    }

    const deleteKeys = [...stationDeletes, ...fleetDeletes].filter((key) => key.startsWith('config.spawnPointSettings.'));
    const invalidDeleteKeys = deleteKeys.filter((key) => !AllowedSpawnPointKeys.has(key));
    if (invalidDeleteKeys.length > 0) return false;

    return true;
}

function getCurrentSpawnSelection(config = {}) {
    const override = config['config.spawnPointSettings.overrideSpawnPoint'];
    const locationX = Number(config['config.spawnPointSettings.overriddenSpawnLocationX']);
    const locationY = Number(config['config.spawnPointSettings.overriddenSpawnLocationY']);
    const locationZ = Number(config['config.spawnPointSettings.overriddenSpawnLocationZ']);
    const yaw = Number(config['config.spawnPointSettings.overriddenSpawnRotationYaw']);
    const roll = Number(config['config.spawnPointSettings.overriddenSpawnRotationRoll']);

    if (override !== true) {
        return SpawnLocationOptions[0];
    }

    const match = SpawnLocationOptions.find((option) => {
        if (option.id === 'club-district') return false;
        const values = option.stationConfig;
        return (
            Number(values['config.spawnPointSettings.overriddenSpawnLocationX']) === locationX &&
            Number(values['config.spawnPointSettings.overriddenSpawnLocationY']) === locationY &&
            Number(values['config.spawnPointSettings.overriddenSpawnLocationZ']) === locationZ &&
            Number(values['config.spawnPointSettings.overriddenSpawnRotationYaw']) === yaw &&
            Number(values['config.spawnPointSettings.overriddenSpawnRotationRoll']) === roll
        );
    });

    return match || SpawnLocationOptions[0];
}

function createSpawnUpdate(selectedId, currentConfig = {}) {
    const selected = SpawnLocationOptions.find((option) => option.id === selectedId) || SpawnLocationOptions[0];
    const stationUpdates = {};
    const stationDeletes = [];
    const fleetDeletes = [];

    if (!selected || selected.id === 'club-district') {
        stationUpdates['config.spawnPointSettings.overrideSpawnPoint'] = false;
        const keys = [
            'config.spawnPointSettings.overriddenSpawnLocationX',
            'config.spawnPointSettings.overriddenSpawnLocationY',
            'config.spawnPointSettings.overriddenSpawnLocationZ',
            'config.spawnPointSettings.overriddenSpawnRotationPitch',
            'config.spawnPointSettings.overriddenSpawnRotationYaw',
            'config.spawnPointSettings.overriddenSpawnRotationRoll'
        ];
        keys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(currentConfig, key)) {
                stationDeletes.push(key);
            }
        });
        return { stationUpdates, stationDeletes, fleetDeletes };
    }

    Object.assign(stationUpdates, selected.stationConfig);
    stationUpdates['config.spawnPointSettings.overrideSpawnPoint'] = true;
    return { stationUpdates, stationDeletes, fleetDeletes };
}

const WeeklyTypeOptions = [
    { id: 'parkour', label: 'Parkour' },
    { id: 'race', label: 'Race' }
];

const WeeklyDistricts = [
    {
        id: 'pink-draft',
        label: 'Pink DRAFT',
        key: 'CustomGamemodes.1200_Full_1',
        allowedTypes: ['parkour', 'race']
    },
    {
        id: 'parkour-annex',
        label: 'Parkour Annex',
        key: 'CustomGamemodes.0300_Full_1',
        allowedTypes: ['parkour', 'race']
    },
    {
        id: 'community-captain',
        label: 'Community Captain',
        key: 'CustomGamemodes.0800_Full_1',
        allowedTypes: ['parkour', 'race']
    }
];

const WeeklyEntries = {
    parkour: [
        { id: 'weekly-parkour-1', label: 'Weekly Parkour 1', value: '1;c;g;28936F154C34F302B1346697FF91D509;;KazzmaniaWeek1NoReward' },
        { id: 'weekly-parkour-2', label: 'Weekly Parkour 2', value: '1;c;g;72616C5649F7A3B23481AEB6EDE719EF;;KazzmaniaWeek2NoReward' },
        { id: 'weekly-parkour-3', label: 'Weekly Parkour 3', value: '1;c;g;88503A1C42A697B55F323FA0460DFAD4;;KazzmaniaWeek3NoReward' },
        { id: 'weekly-parkour-4', label: 'Weekly Parkour 4', value: '1;c;g;80839C024C0F29F05FAEF3AD0611B9C8;;KazzmaniaWeek4NoReward' },
        { id: 'weekly-parkour-5', label: 'Weekly Parkour 5', value: '1;c;g;982324EF49CB54C111F236BE062EFFBC;;KazzmaniaWeek5NoReward' },
        { id: 'weekly-parkour-5-nerfed', label: 'Weekly Parkour 5 Nerfed', value: '1;c;g;E9D4E45F4AEC60F4E636A6A84F30BD74;;KazzmaniaWeek5NerfedNoReward' },
        { id: 'weekly-parkour-6', label: 'Weekly Parkour 6', value: '1;c;g;AF370A644BB17A8296B0FCA2AD5B8E00;;KazzmaniaWeek6NoReward' },
        { id: 'weekly-parkour-7', label: 'Weekly Parkour 7', value: '1;c;g;C662F9DE460AE3F819D44AA6819ABC56;;KazzmaniaWeek7NoReward' },
        { id: 'weekly-parkour-8', label: 'Weekly Parkour 8', value: '1;c;g;BA350C6A4A4A40174B725BB1513FB09E;;KazzmaniaWeek8NoReward' },
        { id: 'weekly-parkour-9', label: 'Weekly Parkour 9', value: '1;c;g;EA18784341E4A92A6C366FA52B68B1D4;;KazzmaniaWeek9NoReward' },
        { id: 'weekly-parkour-10', label: 'Weekly Parkour 10', value: '1;c;g;FF6C79B340CBFC0637769181485A5952;;KazzmaniaWeek10NoReward' },
        { id: 'weekly-parkour-11', label: 'Weekly Parkour 11', value: '1;c;g;BA7947044B8C212EE18CDCADC5963972;;KazzmaniaWeek11NoReward' },
        { id: 'weekly-parkour-12', label: 'Weekly Parkour 12', value: '1;c;g;48B1D1EF4942E5E233E82684DD027DF8;;KazzmaniaWeek12NoReward' },
        { id: 'weekly-parkour-13', label: 'Weekly Parkour 13', value: '1;c;g;BB9DCFA1428CA84627AB2488CE6906C6;;KazzmaniaWeek13NoReward' },
        { id: 'weekly-parkour-14', label: 'Weekly Parkour 14', value: '1;c;g;90E61556489E3C0CE05EDF8ED0EC44EE;;KazzmaniaWeek14NoReward' },
        { id: 'weekly-parkour-15', label: 'Weekly Parkour 15', value: '1;c;g;4FB70F4F4588465FF49A7FAC7A99C8E0;;KazzmaniaWeek15NoReward' },
        { id: 'weekly-parkour-16', label: 'Weekly Parkour 16', value: '1;c;g;75A25DB048A56A19CCE0759CD2D75109;;KazzmaniaWeek16NoReward' },
        { id: 'weekly-parkour-17', label: 'Weekly Parkour 17', value: '1;c;g;50C8006A481494F31156BDA7ED2BA598;;KazzmaniaWeek17NoReward' },
        { id: 'weekly-parkour-18', label: 'Weekly Parkour 18', value: '1;c;g;7EE8E8CD4593D3C7E1A646A1E11999D9;;KazzmaniaWeek18NoReward' },
        { id: 'weekly-parkour-19', label: 'Weekly Parkour 19', value: '1;c;g;531C98CC46D7FD606BD66ABC7CDED5C4;;KazzmaniaWeek19NoReward' },
        { id: 'weekly-parkour-20', label: 'Weekly Parkour 20', value: '1;c;g;D5B08801496D917579C394A35081BDA4;;KazzmaniaWeek20NoReward' },
        { id: 'weekly-parkour-21', label: 'Weekly Parkour 21', value: '1;c;g;A5D00B4348C2190D3531E0A172897792;;KazzmaniaWeek21NoReward' },
        { id: 'weekly-parkour-22', label: 'Weekly Parkour 22', value: '1;c;g;7DF62EC848D0BFE8B6D40495D17B12F5;;KazzmaniaWeek22NoReward' },
        { id: 'weekly-parkour-23', label: 'Weekly Parkour 23', value: '1;c;g;AF4E298546CB9DD421E5558071BBF5E8;;KazzmaniaWeek23NoReward' },
        { id: 'weekly-parkour-24', label: 'Weekly Parkour 24', value: '1;c;g;B846E67043159675E294499225109C4C;;KazzmaniaWeek24NoReward' },
        { id: 'weekly-parkour-25', label: 'Weekly Parkour 25', value: '1;c;g;F09312744FBDD50B666AAB9A3E89F1FE;;KazzmaniaWeek25NoReward' },
        { id: 'weekly-parkour-26', label: 'Weekly Parkour 26', value: '1;c;g;0FF125914FAEE5F2FD4CB7847CD18909;;KazzmaniaWeek26NoReward' },
        { id: 'weekly-parkour-27', label: 'Weekly Parkour 27', value: '1;c;g;0F8AC0AD4FD852E79776278261E0270B;;KazzmaniaWeek27NoReward' },
        { id: 'weekly-parkour-28', label: 'Weekly Parkour 28', value: '1;c;g;695F5EE842A843D3A8067F96F656FA11;;KazzmaniaWeek28NoReward' },
        { id: 'weekly-parkour-29', label: 'Weekly Parkour 29', value: '1;c;g;968FC0604AE4F064AD4AA09EE3E0EBA8;;KazzmaniaWeek29NoReward' },
        { id: 'weekly-parkour-30', label: 'Weekly Parkour 30', value: '1;c;g;807E70B846245B0A80FDA0B8D77BF41B;;KazzmaniaWeek30NoReward' },
        { id: 'weekly-parkour-31', label: 'Weekly Parkour 31', value: '1;c;g;5343DBA74CB93F33F271A8B0D85029CF;;KazzmaniaWeek31NoReward' },
        { id: 'weekly-parkour-32', label: 'Weekly Parkour 32', value: '1;c;g;79EE98C9401AD94C4468E0ABE36D178B;;KazzmaniaWeek32NoReward' },
        { id: 'weekly-parkour-33', label: 'Weekly Parkour 33', value: '1;c;g;9CD516D04EDD053EF1BF5CA1BCB8C7CC;;KazzmaniaWeek33NoReward' },
        { id: 'weekly-parkour-34', label: 'Weekly Parkour 34', value: '1;c;g;259C28B64828A587F26D1794E57DFC95;;KazzmaniaWeek34NoReward' },
        { id: 'weekly-parkour-36', label: 'Weekly Parkour 36', value: '1;c;g;269CF7C04B2E59081CA76E8D12B5DE14;;KazzmaniaWeek36NoReward' },
        { id: 'weekly-parkour-37', label: 'Weekly Parkour 37', value: '1;c;g;0A2459C4418A1F250A15078EED451216;;KazzmaniaWeek37NoReward' },
        { id: 'weekly-parkour-38', label: 'Weekly Parkour 38', value: '1;c;g;7AB4BF78402CF5BECEF022B382DB9E05;;KazzmaniaWeek38NoReward' },
        { id: 'weekly-parkour-39', label: 'Weekly Parkour 39', value: '1;c;g;4D02DF3647F6046C595133A28ECA9D4E;;KazzmaniaWeek39NoReward' },
        { id: 'weekly-parkour-41', label: 'Weekly Parkour 41', value: '1;c;g;87F70A5A4A86523E517CC9A95C5B0F35;;KazzmaniaWeek41NoReward' },
        { id: 'weekly-parkour-42', label: 'Weekly Parkour 42', value: '1;c;g;7494C0B8473CFF099AC3C78E301BE4D2;;KazzmaniaWeek42NoReward' },
        { id: 'weekly-parkour-43', label: 'Weekly Parkour 43', value: '1;c;g;C0635FEC4EB3315D6BB668B6AF0981FF;;KazzmaniaWeek43NoReward' },
        { id: 'weekly-parkour-44', label: 'Weekly Parkour 44', value: '1;c;g;B9F252594435A16008B4609D8693FBB1;;KazzmaniaWeek44NoReward' },
        { id: 'weekly-parkour-45', label: 'Weekly Parkour 45', value: '1;c;g;F5849D664E2D0A45736546B51042AE5D;;KazzmaniaWeek45NoReward' },
        { id: 'weekly-parkour-46', label: 'Weekly Parkour 46', value: '1;c;g;E8B4F76E42D43C4B4C986CBE2D9BA9D7;;KazzmaniaWeek46NoReward' },
        { id: 'weekly-parkour-47', label: 'Weekly Parkour 47', value: '1;c;g;68A92B524DBCFED9351CD7A822E1125E;;KazzmaniaWeek47NoReward' },
        { id: 'weekly-parkour-48', label: 'Weekly Parkour 48', value: '1;c;g;2260735A420B9596D60141BF6CDF8EF6;;KazzmaniaWeek48NoReward' },
        { id: 'weekly-parkour-49', label: 'Weekly Parkour 49', value: '1;c;g;0FC2E962455D4762BCB3B3BAB82C05A4;;KazzmaniaWeek49NoReward' },
        { id: 'weekly-parkour-50', label: 'Weekly Parkour 50', value: '1;c;g;E70F2D2B446AB60F527A6F863A3A6E1D;;KazzmaniaWeek50NoReward' },
        { id: 'weekly-parkour-51', label: 'Weekly Parkour 51', value: '1;c;g;B809CE0E44DA52BEF582F086269846FE;;KazzmaniaWeek51NoReward' },
        { id: 'weekly-parkour-52', label: 'Weekly Parkour 52', value: '1;c;g;7D6237C44723C2C64DB5B78869FED554;;KazzmaniaWeek52NoReward' },
        { id: 'weekly-parkour-53', label: 'Weekly Parkour 53', value: '1;c;g;4114147C4524E70C0679C7A5AA2CA548;;KazzmaniaWeek53NoReward' },
        { id: 'weekly-parkour-54', label: 'Weekly Parkour 54', value: '1;c;g;285E3FC348C55C15FCB720A448425CD4;;KazzmaniaWeek54NoReward' },
        { id: 'weekly-parkour-55', label: 'Weekly Parkour 55', value: '1;c;g;F72F84F24F1913C15B9F7289D64AE0B3;;KazzmaniaWeek55NoReward' },
        { id: 'weekly-parkour-56', label: 'Weekly Parkour 56', value: '1;c;g;1B3A453D42FA1A23B90B5FA0F1276D22;;KazzmaniaWeek56NoReward' },
        { id: 'weekly-parkour-57', label: 'Weekly Parkour 57', value: '1;c;g;308603B84F0CCD8DE18B3688F7553673;;KazzmaniaWeek57NoReward' },
        { id: 'weekly-parkour-58', label: 'Weekly Parkour 58', value: '1;c;g;121DD86347BA349BC28E9FBAF5C16F6E;;KazzmaniaWeek58NoReward' },
        { id: 'weekly-parkour-59', label: 'Weekly Parkour 59', value: '1;c;g;73D9418F441BEE23C70DE6A2672EF91D;;KazzmaniaWeek59NoReward' },
        { id: 'weekly-parkour-60', label: 'Weekly Parkour 60', value: '1;c;g;F5BF30DE467461924955BCA1624BE4AF;;KazzmaniaWeek60NoReward' },
        { id: 'weekly-parkour-61', label: 'Weekly Parkour 61', value: '1;c;g;1694149249771096603D89BA68AAD49A;;KazzmaniaWeek61NoReward' },
        { id: 'weekly-parkour-62', label: 'Weekly Parkour 62', value: '1;c;g;65586216439F6182A7C7A28A80C37ECF;;KazzmaniaWeek62NoReward' },
        { id: 'weekly-parkour-63', label: 'Weekly Parkour 63', value: '1;c;g;C45EB65A476E16CD7A041296435D367A;;KazzmaniaWeek63NoReward' },
        { id: 'weekly-parkour-64', label: 'Weekly Parkour 64', value: '1;c;g;A2DA698140D417FE743FBAB8EC333341;;KazzmaniaWeek64NoReward' },
        { id: 'weekly-parkour-65', label: 'Weekly Parkour 65', value: '1;c;g;69EC3BA340E8BF94F155A5921862821B;;KazzmaniaWeek65NoReward' },
        { id: 'weekly-parkour-66', label: 'Weekly Parkour 66', value: '1;c;g;D57C18FC4599C365542CA1B76C53183F;;KazzmaniaWeek66NoReward' },
        { id: 'weekly-parkour-67', label: 'Weekly Parkour 67', value: '1;c;g;7E20FEDC4213AC47DB6167B3762DC247;;KazzmaniaWeek67NoReward' },
        { id: 'weekly-parkour-68', label: 'Weekly Parkour 68', value: '1;c;g;99A8933C4F833BFAA9E9FD9901B346F9;;KazzmaniaWeek68NoReward' },
        { id: 'weekly-parkour-69', label: 'Weekly Parkour 69', value: '1;c;g;E2C8BA2E489EB922A7E08392740996BB;;KazzmaniaWeek69NoReward' },
        { id: 'weekly-parkour-70', label: 'Weekly Parkour 70', value: '1;c;g;DFBC119A43DAB245C62851A2E9DD09EA;;KazzmaniaWeek70NoReward' },
        { id: 'weekly-parkour-71', label: 'Weekly Parkour 71', value: '1;c;g;25FA43D24863ABC8E432B989E05A5431;;KazzmaniaWeek71NoReward' },
        { id: 'weekly-parkour-72', label: 'Weekly Parkour 72', value: '1;c;g;7203B6DC4F2AD6CF381813BFB3CCE75C;;KazzmaniaWeek72NoReward' },
        { id: 'weekly-parkour-73', label: 'Weekly Parkour 73', value: '1;c;g;4A52671442EF098B7269BF9FD43CF373;;KazzmaniaWeek73NoReward' },
        { id: 'weekly-parkour-74', label: 'Weekly Parkour 74', value: '1;c;g;2F7521204BBAD2C5D04265B5CAA81810;;KazzmaniaWeek74NoReward' },
        { id: 'weekly-parkour-75', label: 'Weekly Parkour 75', value: '1;c;g;FC8646A243D6459E1AE9C595431F62BA;;KazzmaniaWeek75NoReward' }
    ],
    race: [
        { id: 'weekly-race-1', label: 'Weekly Race 1', value: '1;c;g;A1E32A2E45C14B1036B93D8038BF4500;;WeeklyRace1NoReward' },
        { id: 'weekly-race-2', label: 'Weekly Race 2', value: '1;c;g;A073BD314063C7EDEDF896B1B4B50CD9;;WeeklyRace2NoReward' },
        { id: 'weekly-race-3', label: 'Weekly Race 3', value: '1;c;g;79C7F9144DAA23D241231994CF2F03E7;;WeeklyRace3NoReward' },
        { id: 'weekly-race-4', label: 'Weekly Race 4', value: '1;c;g;43EBA5974CD6BA8E69FF9AAC43965EAF;;WeeklyRace4NoReward' },
        { id: 'weekly-race-5', label: 'Weekly Race 5', value: '1;c;g;69B4DDF04F3B14ED732D94ADB8CA8D28;;WeeklyRace5NoReward' },
        { id: 'weekly-race-6', label: 'Weekly Race 6', value: '1;c;g;DD4B4515443099A67869E6846AB4180B;;WeeklyRace6NoReward' },
        { id: 'weekly-race-7', label: 'Weekly Race 7', value: '1;c;g;614D08CF4A6A9075BB1B5C8E57E6E4F3;;WeeklyRace7NoReward' },
        { id: 'weekly-race-8', label: 'Weekly Race 8', value: '1;c;g;B4B8BEE948FFDAB8C9EDCF90E60C57C1;;WeeklyRace8NoReward' },
        { id: 'weekly-race-9', label: 'Weekly Race 9', value: '1;c;g;407319C54183B09A1220B982DD03FDD8;;WeeklyRace9NoReward' },
        { id: 'weekly-race-10', label: 'Weekly Race 10', value: '1;c;g;C259280E4984271852F998BB27EF22A6;;WeeklyRace10NoReward' },
        { id: 'weekly-race-11', label: 'Weekly Race 11', value: '1;c;g;8861BEA949872A11F0CDF1AAE3FFD33A;;WeeklyRace11NoReward' },
        { id: 'weekly-race-12', label: 'Weekly Race 12', value: '1;c;g;C8062E2A4684F685C6A6ADA82B462729;;WeeklyRace12NoReward' },
        { id: 'weekly-race-13', label: 'Weekly Race 13', value: '1;c;g;207D7B5F4A169AE5D40CC8ACD1A2CDAC;;WeeklyRace13NoReward' },
        { id: 'weekly-race-14', label: 'Weekly Race 14', value: '1;c;g;20100D3A49E3802ABF566CB525AF312A;;WeeklyRace14NoReward' },
        { id: 'weekly-race-15', label: 'Weekly Race 15', value: '1;c;g;E4D73407499E3EC6B66E5FB05481207A;;WeeklyRace15NoReward' },
        { id: 'weekly-race-16', label: 'Weekly Race 16', value: '1;c;g;2B0EC1D444A2E9C7DEFD3FACCD79CEFF;;WeeklyRace16NoReward' },
        { id: 'weekly-race-17', label: 'Weekly Race 17', value: '1;c;g;3A4C87FB4AAD46785C974EB3D862E942;;WeeklyRace17NoReward' },
        { id: 'weekly-race-18', label: 'Weekly Race 18', value: '1;c;g;769B4E11498D69765E67969320E72B91;;WeeklyRace18NoReward' },
        { id: 'weekly-race-19', label: 'Weekly Race 19', value: '1;c;g;907EC5B54F2D6B433CCE7D9274CBA504;;WeeklyRace19NoReward' },
        { id: 'weekly-race-20', label: 'Weekly Race 20', value: '1;c;g;ED9304B54AFD795D01EA76AE29E6959C;;WeeklyRace20NoReward' },
        { id: 'weekly-race-21', label: 'Weekly Race 21', value: '1;c;g;94C97CD24BD12A2EF01CA48997E26585;;WeeklyRace21NoReward' },
        { id: 'weekly-race-22', label: 'Weekly Race 22', value: '1;c;g;54ADA4EF48D7C933682B5D982B0B52B6;;WeeklyRace22NoReward' },
        { id: 'weekly-race-23', label: 'Weekly Race 23', value: '1;c;g;8ACE2E04449C9297873A3F9B4E6CA9BB;;WeeklyRace23NoReward' },
        { id: 'weekly-race-24', label: 'Weekly Race 24', value: '1;c;g;BDA7288949C7FECA60B9FB81B83C2AA7;;WeeklyRace24NoReward' },
        { id: 'weekly-race-25', label: 'Weekly Race 25', value: '1;c;g;576A734E4244B35779A1C1BD3B0DCAD8;;WeeklyRace25NoReward' },
        { id: 'weekly-race-26', label: 'Weekly Race 26', value: '1;c;g;8161F85B4354EBF703339BBDF203DA2A;;WeeklyRace26NoReward' },
        { id: 'weekly-race-27', label: 'Weekly Race 27', value: '1;c;g;EBB462A844D03534203E48BC556A574C;;WeeklyRace27NoReward' },
        { id: 'weekly-race-28', label: 'Weekly Race 28', value: '1;c;g;0095711348DE607C709478A17DBC072E;;WeeklyRace28NoReward' },
        { id: 'weekly-race-29', label: 'Weekly Race 29', value: '1;c;g;93181ECF4EFECA9B55FF3DAEEF279C17;;WeeklyRace29NoReward' },
        { id: 'weekly-race-30', label: 'Weekly Race 30', value: '1;c;g;36A3A5674207F73961272B91124DA420;;WeeklyRace30NoReward' },
        { id: 'weekly-race-31', label: 'Weekly Race 31', value: '1;c;g;E105F8044DB70EA6AE7D5BBE00563A92;;WeeklyRace31NoReward' },
        { id: 'weekly-race-32', label: 'Weekly Race 32', value: '1;c;g;728CE17C418DAF3D88AC209B857948AC;;WeeklyRace32NoReward' },
        { id: 'weekly-race-33', label: 'Weekly Race 33', value: '1;c;g;C3B53A2349369B4A92D5EDB8DCB11457;;WeeklyRace33NoReward' },
        { id: 'weekly-race-34', label: 'Weekly Race 34', value: '1;c;g;795A209A445137959FF5428ABDC634BA;;WeeklyRace34NoReward' },
        { id: 'weekly-race-35', label: 'Weekly Race 35', value: '1;c;g;1A984EBA422AC2CB74A448AB7CA86DE6;;WeeklyRace35NoReward' },
        { id: 'weekly-race-36', label: 'Weekly Race 36', value: '1;c;g;600A20C748F112CD33D3AFB3ED8D06FD;;WeeklyRace36NoReward' }
    ]
};

function getWeeklyDistrictByKey(key) {
    return WeeklyDistricts.find((district) => district.key === key) || null;
}

function getWeeklyOptionsForType(type, districtId) {
    const list = WeeklyEntries[type] || [];
    return list;
}

function findWeeklyByValue(value) {
    if (!value) return null;
    for (const type of Object.keys(WeeklyEntries)) {
        const match = WeeklyEntries[type].find((entry) => entry.value === value);
        if (match) return match;
    }
    return null;
}

function getCurrentWeeklySelection(config = {}) {
    for (const district of WeeklyDistricts) {
        const value = config[district.key];
        if (typeof value === 'string' && value.trim() !== '') {
            return {
                district,
                weekly: findWeeklyByValue(value),
                key: district.key,
                value
            };
        }
    }
    return null;
}

if (typeof module !== 'undefined') {
    module.exports = {
        SpawnLocationOptions,
        AllowedSpawnPointPresets,
        AllowedSpawnPointKeys,
        getCurrentSpawnSelection,
        createSpawnUpdate,
        validateSpawnPointUpdate,
        matchesAllowedSpawnPreset,
        WeeklyTypeOptions,
        WeeklyDistricts,
        WeeklyEntries,
        getWeeklyDistrictByKey,
        getWeeklyOptionsForType,
        findWeeklyByValue,
        getCurrentWeeklySelection
    };
}
