// Constructor — identidade, dados e protocolo de cada hotel.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;

  if(!ctx.protocols?.habblive||!ctx.protocols?.habblet)throw Error('Os protocolos do Constructor não foram carregados.');
  const profiles = Object.freeze({
    habblive: Object.freeze({id:'habblive',name:'Habblive',domain:'habblive.in',database:'habblive-oficina',storagePrefix:'',furniture:'habblive.json',protocol:ctx.protocols.habblive}),
    habblet: Object.freeze({id:'habblet',name:'Habblet',domain:'habblet.city',database:'habblet-oficina',storagePrefix:'habblet:',furniture:'habblet.json',protocol:ctx.protocols.habblet})
  });
  ctx.hotels = profiles;
  ctx.detectHotel = hostname => Object.values(profiles).find(profile => {
    const host = String(hostname || '').toLowerCase();
    return host === profile.domain || host.endsWith('.' + profile.domain);
  }) || null;
  ctx.hotel = ctx.detectHotel(location.hostname);
  ctx.protocolMessage = ctx.hotel
    ? 'Constructor no ' + ctx.hotel.name + ': protocolo ainda não validado. Aguardando os pacotes deste hotel.'
    : 'Constructor: este domínio ainda não é compatível.';
  ctx.parts.add('hotels.js');
})();
