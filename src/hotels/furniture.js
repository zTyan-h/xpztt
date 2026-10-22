// Constructor — FurnitureData local por hotel, sem ofertas de compra.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  const pending = new Map();

  function index(items) {
    if (!Array.isArray(items)) throw Error('FurnitureData sem lista de móveis.');
    const byId = new Map(), byClassname = new Map();
    for (const item of items) {
      if (!Number.isInteger(item.id) || item.id <= 0 || typeof item.classname !== 'string' || !item.classname) continue;
      if (!byId.has(item.id)) byId.set(item.id, []);
      byId.get(item.id).push(item);
      if (!byClassname.has(item.classname)) byClassname.set(item.classname, []);
      byClassname.get(item.classname).push(item);
    }
    if (!byId.size) throw Error('FurnitureData sem móveis reconhecidos.');
    // Preserva candidatos e duplicações; não resolve equivalências arbitrariamente.
    return {byId,byClassname,count:items.length};
  }

  ctx.loadFurniture = function (hotelId = ctx.hotel?.id) {
    if (pending.has(hotelId)) return pending.get(hotelId);
    const hotel = Object.hasOwn(ctx.hotels,hotelId)?ctx.hotels[hotelId]:null;
    if (!hotel) return Promise.reject(Error('Hotel inválido para carregar os móveis.'));
    const request = (async () => {
      const url = ctx.platform.assetUrl('furnis/' + hotel.furniture);
      url.searchParams.set('v', ctx.version);
      const response = await ctx.platform.request(url.href, {signal:AbortSignal.any([ctx.ac.signal,AbortSignal.timeout(30000)])});
      if (!response.ok) throw Error('FurnitureData do ' + hotel.name + ' indisponível (HTTP ' + response.status + ').');
      const data = await response.json();
      if (!ctx.current()) throw new DOMException('Constructor encerrado', 'AbortError');
      const result = {hotel:hotel.id,floor:index(data.roomitemtypes?.furnitype),wall:index(data.wallitemtypes?.furnitype)};
      if (hotel.id === ctx.hotel?.id) ctx.furnitureData = result;
      return result;
    })().catch(error => { pending.delete(hotelId); throw error; });
    pending.set(hotelId, request);
    return request;
  };
  ctx.parts.add('furniture.js');
})();
