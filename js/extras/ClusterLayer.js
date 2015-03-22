dojo.provide("extras.ClusterLayer");

dojo.declare("extras.ClusterLayer", esri.layers.GraphicsLayer, {
  constructor: function(options) {
    this._clusterTolerance = options.distance || 50;
    this._clusterData = options.data || [];
    this._clusters = [];
    this._clusterLabelColor = options.labelColor || "#000";
    // labelOffset can be zero so handle it differently
    this._clusterLabelOffset = (options.hasOwnProperty("labelOffset")) ? options.labelOffset : -5;
	this._fontSize = new esri.symbol.Font(options.fontSize) || new esri.symbol.Font("12pt");
	this._fontFamily = options.fontFamily || "Serif";
	this._lastClusterIdOver = 0;
    // graphics that represent a single point
    this._singles = []; // populated when a graphic is clicked
    this._showSingles = options.hasOwnProperty("showSingles") ? options.showSingles : true;
    // symbol for single graphics
	this._singleColor = options.singleColor
    var sms = esri.symbol.SimpleMarkerSymbol;
    this._singleSym = new sms("circle", 6, null, new dojo.Color(this._singleColor)) || new sms("circle", 6, null, new dojo.Color("#888"));
    this._singleTemplate = options.singleTemplate || new esri.dijit.PopupTemplate({ "title": "", "description": "{*}" });
    this._maxSingles = options.maxSingles || 1000;

    this._webmap = options.hasOwnProperty("webmap") ? options.webmap : false;

    this._sr = options.spatialReference || new esri.SpatialReference({ "wkid": 102100 });

    this._zoomEnd = null;
  },

  /*
    override esri.layers.GraphicsLayer methods
  */
  
  _setMap: function(map, surface) {
    // calculate and set the initial resolution
    this._clusterResolution = map.extent.getWidth() / map.width * 1.5; // probably a bad default...
    this._clusterGraphics();

    // connect to onZoomEnd so data is re-clustered when zoom level changes
    this._zoomEnd = dojo.connect(map, "onZoomEnd", this, function() {
      // update resolution
      this._clusterResolution = this._map.extent.getWidth() / this._map.width  * 1.5;;
      this.clear();
      this._clusterGraphics();
    });

    // GraphicsLayer will add its own listener here
    var div = this.inherited(arguments);
    return div;
  },

  _unsetMap: function() {
    this.inherited(arguments);
    dojo.disconnect(this._zoomEnd);
  },

  add: function(p) {
    // if passed a graphic, use the GraphicsLayer's add method
    if ( p.declaredClass ) {
      this.inherited(arguments);
      return;
    }

    // add the new data to _clusterData so that it's included in clusters
    // when the map level changes
    this._clusterData.push(p);
    var clustered = false;
    // look for an existing cluster for the new point
    for ( var i = 0; i < this._clusters.length; i++ ) {
      var c = this._clusters[i];
      if ( this._clusterTest(p, c) ) {
        // add the point to an existing cluster
        this._clusterAddPoint(p, c);
        // update the cluster's geometry
        this._updateClusterGeometry(c);
        // update the label
        this._updateLabel(c);
        clustered = true;
        break;
      }
    }

    if ( ! clustered ) {
      this._clusterCreate(p);
      p.attributes.clusterCount = 1;
      this._showCluster(p);
    }
  },

  clear: function() {
    this.inherited(arguments);
    this._clusters.length = 0;
  },

  clearSingles: function(singles) {
    var s = singles || this._singles;
    dojo.forEach(s, function(g) {
      this.remove(g);
    }, this);
    this._singles.length = 0;
  },

  onClick: function(e) {
	// remove any previously showing single features
    this.clearSingles(this._singles);

    // find single graphics that make up the cluster that was clicked
    // would be nice to use filter but performance tanks with large arrays in IE
    var singles = [];
    for ( var i = 0, il = this._clusterData.length; i < il; i++) {
      if ( e.graphic.attributes.clusterId == this._clusterData[i].attributes.clusterId ) {
        singles.push(this._clusterData[i]);
      }
    }
	
    if ( singles.length > this._maxSingles ) {
      alert("Sorry, that cluster contains more than 1000 points. Zoom in for more detail.");
      return;
    } else {
      // stop the click from bubbling to the map
      e.stopPropagation();
	  var geo = esri.geometry.toScreenGeometry(map.extent, map.width, map.height, e.graphic.geometry)
	  //this._map.infoWindow.show(e.graphic.geometry);
		if (geo.x > map.width) {
			//alert("x: " + geo.x + " | screen y: " + geo.y + " | screen width: " + map.width + " | diff: " + (geo.x - map.width))
		}
      //
      this._addSingles(singles);
    }
	
  },
  
   onMouseOver: function(e) {
	if ((e.graphic.attributes.clusterId == this._lastClusterIdOver) && (this._map.infoWindow.isShowing == true)) {
		this._lastClusterIdOver = e.graphic.attributes.clusterId
		return;
	} else {
		this._lastClusterIdOver = e.graphic.attributes.clusterId
		// remove any previously showing single features
		//this._map.infoWindow.hide();
		this.clearSingles(this._singles);

		// find single graphics that make up the cluster that was clicked
		// would be nice to use filter but performance tanks with large arrays in IE
		var singles = [];
		for ( var i = 0, il = this._clusterData.length; i < il; i++) {
		  if ( e.graphic.attributes.clusterId == this._clusterData[i].attributes.clusterId ) {
			singles.push(this._clusterData[i]);
		  }
		}
		if ( singles.length > this._maxSingles ) {
		  alert("Sorry, that cluster contains more than 1000 points. Zoom in for more detail.");
		  return;
		} else {
		  this._addSingles(singles);
		}
	}
	
  }, 
  
   onMouseOut: function(e) {
    // remove any previously showing single features
    if (this._map.infoWindow.isShowing == false) { this.clearSingles(this._singles); }
  }, 

  /*
    internal methods
  */
  
  _clusterGraphics: function() {
    // first time through, loop through the points
    for ( var j = 0, jl = this._clusterData.length; j < jl; j++ ) {
      // see if the current feature should be added to a cluster
      var point = this._clusterData[j];
      var clustered = false;
      var numClusters = this._clusters.length;
      for ( var i = 0; i < this._clusters.length; i++ ) {
        var c = this._clusters[i];
        if ( this._clusterTest(point, c) ) {
          this._clusterAddPoint(point, c);
          clustered = true;
          break;
        }
      }

      if ( ! clustered ) {
        this._clusterCreate(point);
      }
    }
    this._showAllClusters();
  },

  _clusterTest: function(p, cluster) {
    var distance = (
      Math.sqrt(
        Math.pow((cluster.x - p.x), 2) + Math.pow((cluster.y - p.y), 2)
      ) / this._clusterResolution
    );
    return (distance <= this._clusterTolerance);
  },

  // points passed to clusterAddPoint should be included 
  // in an existing cluster
  // also give the point an attribute called clusterId 
  // that corresponds to its cluster
  _clusterAddPoint: function(p, cluster) {
    // average in the new point to the cluster geometry
    var count, x, y;
    count = cluster.attributes.clusterCount;
    x = (p.x + (cluster.x * count)) / (count + 1);
    y = (p.y + (cluster.y * count)) / (count + 1);
    cluster.x = x;
    cluster.y = y;

    // build an extent that includes all points in a cluster
    // extents are for debug/testing only...not used by the layer
    if ( p.x < cluster.attributes.extent[0] ) {
      cluster.attributes.extent[0] = p.x;
    } else if ( p.x > cluster.attributes.extent[2] ) {
      cluster.attributes.extent[2] = p.x;
    }
    if ( p.y < cluster.attributes.extent[1] ) {
      cluster.attributes.extent[1] = p.y;
    } else if ( p.y > cluster.attributes.extent[3] ) {
      cluster.attributes.extent[3] = p.y;
    }

    // increment the count
    cluster.attributes.clusterCount++;
    // attributes might not exist
    if ( ! p.hasOwnProperty("attributes") ) {
      p.attributes = {};
    }
    // give the graphic a cluster id
    p.attributes.clusterId = cluster.attributes.clusterId;
  },

  // point passed to clusterCreate isn't within the 
  // clustering distance specified for the layer so
  // create a new cluster for it
  _clusterCreate: function(p) {
    var clusterId = this._clusters.length + 1;
    // console.log("cluster create, id is: ", clusterId);
    // p.attributes might be undefined
    if ( ! p.attributes ) {
      p.attributes = {};
    }
    p.attributes.clusterId = clusterId;
    // create the cluster
    var cluster = { 
      "x": p.x,
      "y": p.y,
      "attributes" : {
        "clusterCount": 1,
        "clusterId": clusterId,
        "extent": [ p.x, p.y, p.x, p.y ]
      }
    };
    this._clusters.push(cluster);
  },

  _showAllClusters: function() {
    for ( var i = 0, il = this._clusters.length; i < il; i++ ) {
      var c = this._clusters[i];
      this._showCluster(c);
    }
  },

  _showCluster: function(c) {
    var point = new esri.geometry.Point(c.x, c.y, this._sr);
    this.add(
      new esri.Graphic(
        point, 
        null, 
        c.attributes
      )
    );
    /*
	// code below is used to not label clusters with a single point
    if ( c.attributes.clusterCount == 1 ) {
      return;
    }
	*/
    // show number of points in the cluster
    var label = new esri.symbol.TextSymbol(c.attributes.clusterCount)
      .setColor(new dojo.Color(this._clusterLabelColor))
      .setOffset(0, this._clusterLabelOffset);
	  var font = new esri.symbol.Font(this._fontSize, esri.symbol.Font.STYLE_NORMAL, esri.symbol.Font.VARIANT_NORMAL, esri.symbol.Font.WEIGHT_NORMAL);
	  font.setFamily(this._fontFamily);
	  label.setFont(font);
    this.add(
      new esri.Graphic(
        point,
        label,
        c.attributes
      )
    );
  },

  _addSingles: function(singles) {
    // add single graphics to the map
    dojo.forEach(singles, function(p) {
      var g = new esri.Graphic(
        new esri.geometry.Point(p.x, p.y, this._sr),
        this._singleSym,
        p.attributes,
        // new esri.InfoTemplate("", "${*}")
        this._singleTemplate
      );
      this._singles.push(g);
      if ( this._showSingles ) {
        this.add(g);
      }
    }, this);
    this._map.infoWindow.setFeatures(this._singles);
  },

  _updateClusterGeometry: function(c) {
    // find the cluster graphic
    var cg = dojo.filter(this.graphics, function(g) {
      return ! g.symbol &&
             g.attributes.clusterId == c.attributes.clusterId;
    });
    if ( cg.length == 1 ) {
      cg[0].geometry.update(c.x, c.y);
    } else {
      console.log("didn't find exactly one CLUSTER GEOMETRY to update: ", cg);
    }
  },

  _updateLabel: function(c) {
    // find the existing label
    var label = dojo.filter(this.graphics, function(g) {
      return g.symbol && 
             g.symbol.declaredClass == "esri.symbol.TextSymbol" &&
             g.attributes.clusterId == c.attributes.clusterId;
    });
    if ( label.length == 1 ) {
      // console.log("update label...found: ", label);
      this.remove(label[0]);
      var newLabel = new esri.symbol.TextSymbol(c.attributes.clusterCount).setColor(new dojo.Color(this._clusterLabelColor)).setOffset(0, this._clusterLabelOffset);
	  var font = new esri.symbol.Font(this._fontSize, esri.symbol.Font.STYLE_NORMAL, esri.symbol.Font.VARIANT_NORMAL, esri.symbol.Font.WEIGHT_NORMAL);
	  font.setFamily(this._fontFamily);
	  newLabel.setFont(font);
      this.add(
        new esri.Graphic(
          new esri.geometry.Point(c.x, c.y, this._sr),
          newLabel,
          c.attributes
        )
      );
      // console.log("updated the label");
    } else {
      console.log("didn't find exactly one LABEL: ", label);
    }
  },

  // debug only...never called by the layer
  _clusterMeta: function() {
    // print total number of features
    console.log("Total:  ", this._clusterData.length);

    // add up counts and print it
    var count = 0;
    dojo.forEach(this._clusters, function(c) {
      count += c.attributes.clusterCount;
    });
    console.log("In clusters:  ", count);
  }

});
