(function(root){
  'use strict';
  function clone(ol,layers){
    return layers.map(layer=>{
      const original=layer.getSource();
      const source=new ol.source.XYZ({
        projection:original.getProjection(),tileGrid:original.getTileGrid(),
        tilePixelRatio:original.getTilePixelRatio(1),wrapX:original.getWrapX(),transition:0,
        tileUrlFunction:original.getTileUrlFunction(),tileLoadFunction:original.getTileLoadFunction(),
        attributions:original.getAttributions()
      });
      return new ol.layer.Tile({source,opacity:layer.getOpacity()});
    });
  }
  const api={clone};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BearEstimateHistoryTiles=api;
})(typeof window!=='undefined'?window:globalThis);
