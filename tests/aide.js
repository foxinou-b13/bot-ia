/**
 * tests/aide.js — petits faux objets Discord pour tester sans réseau.
 */
const { PermissionsBitField } = require('discord.js');

function rolesMock({ position = 1, ids = [] } = {}) {
  const cache = new Map(ids.map((id) => [id, { id, name: id }]));
  cache.has = cache.has.bind(cache);
  return {
    highest: { position },
    position,
    cache,
    add: async () => true,
    remove: async () => true,
  };
}

function membreMock({
  id = 'membre1',
  tag = 'Membre#0001',
  bot = false,
  permissions = [],
  position = 1,
  roleIds = [],
  sendEchoue = true,
} = {}) {
  const membre = {
    id,
    user: { id, tag, username: tag.split('#')[0], bot },
    displayName: tag.split('#')[0],
    roles: rolesMock({ position, ids: roleIds }),
    permissions: new PermissionsBitField(permissions),
    actions: [],
    ban: async (options) => membre.actions.push(['ban', options]),
    kick: async (raison) => membre.actions.push(['kick', raison]),
    timeout: async (ms, raison) => membre.actions.push(['timeout', ms, raison]),
    rolesEdit: null,
    send: async (contenu) => {
      if (sendEchoue) throw new Error('MP fermés');
      membre.actions.push(['mp', contenu]);
      return {};
    },
  };
  return membre;
}

function guildeMock({
  id = 'G1',
  nom = 'Serveur Test',
  ownerId = 'proprio',
  moiPermissions = ['BanMembers', 'KickMembers', 'ModerateMembers', 'ManageMessages', 'ManageRoles', 'ManageChannels', 'ManageGuild'],
  moiPosition = 50,
} = {}) {
  const moi = membreMock({ id: 'bot', tag: 'Otaku#0001', bot: true, permissions: moiPermissions, position: moiPosition });
  const salons = new Map();
  const guilde = {
    id,
    name: nom,
    ownerId,
    memberCount: 42,
    roles: {
      everyone: { id, name: '@everyone' },
      highest: { position: 100 },
      cache: new Map(),
    },
    members: { me: moi, cache: new Map() },
    channels: {
      cache: {
        get: (cid) => salons.get(cid) || null,
        has: (cid) => salons.has(cid),
      },
    },
    salonsDeTest: salons,
  };
  return guilde;
}

function salonMock({ id = 'C1', nom = 'général' } = {}) {
  const messages = [];
  return {
    id,
    name: nom,
    messagesEnvoyes: messages,
    send: async (contenu) => {
      messages.push(contenu);
      return { id: 'msg', delete: async () => true };
    },
    messages: { fetch: async () => new Map() },
    bulkDelete: async () => new Map(),
    setRateLimitPerUser: async (n) => { messages.push(['slowmode', n]); },
    permissionOverwrites: { edit: async () => true },
  };
}

function interactionMock({
  commandName = 'test',
  guildId = 'G1',
  guild = guildeMock(),
  membre = membreMock({ permissions: ['BanMembers', 'KickMembers', 'ModerateMembers', 'ManageMessages', 'ManageRoles', 'ManageChannels', 'ManageGuild'] }),
  options = {},
  salon = salonMock(),
} = {}) {
  const journal = [];
  const interaction = {
    commandName,
    guildId: guild ? guild.id : null,
    guild,
    member: membre,
    user: { id: membre.id, tag: membre.user.tag, username: membre.user.username, bot: false },
    channelId: salon.id,
    channel: salon,
    journal,
    deferred: false,
    replied: false,
    inGuild: () => Boolean(guild),
    isChatInputCommand: () => true,
    options: {
      getString: (k) => (k in options ? options[k] : null),
      getInteger: (k) => (k in options ? options[k] : null),
      getBoolean: (k) => (k in options ? options[k] : null),
      getUser: (k) => options[k] ?? null,
      getMember: (k) => options[k] ?? null,
      getRole: (k) => options[k] ?? null,
      getChannel: (k) => options[k] ?? null,
    },
    async reply(paquet) {
      journal.push(['reply', paquet]);
      interaction.replied = true;
      return { id: 'r1' };
    },
    async deferReply(paquet) {
      journal.push(['deferReply', paquet]);
      interaction.deferred = true;
      return { id: 'r1' };
    },
    async editReply(paquet) {
      journal.push(['editReply', paquet]);
      return { id: 'r1' };
    },
    async followUp(paquet) {
      journal.push(['followUp', paquet]);
      return { id: 'r2' };
    },
  };
  return interaction;
}

/** Texte complet de tout ce que le bot a répondu (facilite les vérifications). */
function texteReponses(interaction) {
  return interaction.journal
    .map(([, paquet]) => {
      if (!paquet) return '';
      const embeds = (paquet.embeds || []).map((e) => {
        const json = typeof e.toJSON === 'function' ? e.toJSON() : e;
        return `${json.title || ''} ${json.description || ''}`;
      }).join(' ');
      return `${paquet.content || ''} ${embeds}`;
    })
    .join(' | ');
}

module.exports = {
  membreMock,
  guildeMock,
  salonMock,
  interactionMock,
  texteReponses,
  PermissionsBitField,
};
