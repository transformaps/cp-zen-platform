'use strict';
/* global google,jQuery,MarkerClusterer */

//  TODO : reuse cd-dojos-map instead of this mixed-up controller
function cdDojosMapCtrl($scope, $window, $state, $stateParams, $translate, $geolocation,
  $q, $location, cdDojoService, $anchorScroll, $timeout,
  gmap, Geocoder, atomicNotifyService, usSpinnerService, dojoUtils) {
  $scope.model = {};
  $scope.markers = [];
  $scope.getDojoURL = dojoUtils.getDojoURL;
  var hash = $location.hash();
  var markerClusterer;
  var centerLocation = new google.maps.LatLng(25, -5);
  $scope.pos = centerLocation;

  $geolocation.watchPosition({
    timeout: 60000,
    maximumAge: 250,
    enableHighAccuracy: true
  })

  $scope.loadMap = function () {
    // If we are on the list page already
    if ($stateParams.list === 'true') {
      // Remove the list param from the url
      $state.go('home', { list: undefined });
    }

    if (!$scope.isMapLoaded) {
      if (gmap) {
        $scope.mapLoaded = true;
        $scope.mapOptions = {
          center: centerLocation,
          zoom: 2,
          mapTypeId: google.maps.MapTypeId.ROADMAP
        };

        $window.setTimeout(function(){
          if($scope.model.map) {
            var center = $scope.model.map.getCenter();
            google.maps.event.trigger($scope.model.map, 'resize');
            $scope.model.map.setCenter(center);
          }
        }, 100);
      }

      clearMarkers();
      cdDojoService.list({
        verified: 1,
        deleted: 0,
        fields$: ['name', 'geo_point', 'stage', 'url_slug', 'private']
      }, function (dojos) {
        var filteredDojos = filterInactiveDojos(dojos);

        addMarkersToMap(filteredDojos).then(function () {
          setZoom();
        }, function (error) {
          console.error("Failed!", error);
        });
      });

      if ($scope.model.map) {
        $scope.searchResult = null;
        delete $scope.search.dojo;
      }

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (position) {
          $scope.pos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          $scope.model.map.setCenter($scope.pos);
          setZoom();
        }, function () {
          $scope.pos = centerLocation;
          setZoom();
        });
      } else {
        $scope.pos = centerLocation;
        $scope.model.map.setCenter($scope.pos);
      }
      $scope.isMapLoaded = true;
    }
  }

  $scope.isMapLoaded = false;

  if ($stateParams.list === 'true') {
    // Switch to the second tab (i.e. the list tab)
    // Note: this triggers the select attribute of the tab, 'loadDojosList' function
    $scope.activeTabIndex = 1;
  }

  if ($stateParams.bannerMessage) {
    var type = $stateParams.bannerType || 'info';
    var timeCollapse = $stateParams.bannerTimeCollapse || 5000;
    switch(type) {
      case 'success':
        atomicNotifyService.success($stateParams.bannerMessage, timeCollapse);
        break;
      default:
        atomicNotifyService.info($stateParams.bannerMessage, timeCollapse);
        break;
    }
  }

  $scope.$on('$destroy', function(){
    atomicNotifyService.dismissAll();
  });

  $scope.loadDojosList = loadDojosList;

  function loadDojosList() {
    // If we aren't on the list page already
    if ($stateParams.list === 'false' || !$stateParams.list) {
      $state.go('home', { list: 'true' });
    }

    if(!$scope.dojoList || $scope.dojoList.length <= 0) {
      usSpinnerService.spin('dojos-list-spinner');
      cdDojoService.dojosByCountry({verified: 1, deleted: 0}, function (dojos) {
        $scope.dojoList = dojos;
        usSpinnerService.stop('dojos-list-spinner');
        if (hash) {
          $timeout(function () {
            $anchorScroll(hash);
          });
        }
      });
    }
  }

  $scope.viewDojo = function(dojo) {
    var urlSlug = dojo.url_slug || dojo.urlSlug;
    var urlSlugArray = urlSlug.split('/');
    var country = urlSlugArray[0].toString();
    urlSlugArray.splice(0, 1);
    var path = urlSlugArray.join('/');
    $state.go('dojo-detail',{country: country, path: path});
  }

  $scope.getDojo = function (marker) {
    var dojoId = marker.dojoId;
    cdDojoService.load(dojoId, function (response) {
      $scope.getDojoURL(response);
    });
  };

  $scope.openMarkerInfo = function(marker) {
    if (marker.dojoId) {
      $scope.currentMarker = marker;
      $scope.model.markerInfoWindow.open($scope.model.map, marker);
    }
  };

  $scope.search = function () {
    if (!$scope.search.dojo) return;
    return $state.go($state.current, {search: $scope.search.dojo}, {reload: true});
  };

  function searchArea(address, country, callback) {
    Geocoder.geocode(address, country).then(function (results) {
      if (!results.length) return;
      var location = results[0].geometry.location;
      if (results[0].geometry.bounds) {
        var bounds = results[0].geometry.bounds;
        searchBounds(location, bounds, $scope.search.dojo);
      } else {
        searchNearest(location, $scope.search.dojo);
      }
    }, function (reason) {
      $scope.searchResult = true;
      $scope.noResultsFound = $translate.instant('No Dojos match your search query.');
    });
  }

  if($stateParams.search){
    $scope.search.dojo = $stateParams.search;
    $scope.searchResult = null;
    $scope.noResultsFound = null;
    //reverse look up current country
    $scope.myPosition = $geolocation.position;
    var address = $scope.search.dojo;
    if(_.isEmpty($scope.myPosition) || !_.isUndefined($scope.myPosition.error)) {
      searchArea(address);
    } else {
      Geocoder.reverse($scope.myPosition.coords).then(function (results) {
        if (!results.length) return;
        var country = results[0].address_components[results[0].address_components.length-1].short_name;
        searchArea(address, country);
      });
    }
  }

  function clearMarkers() {
    _.each($scope.markers, function (marker) {
      marker.setMap(null);
    });
    $scope.markers = [];
  }

  function filterInactiveDojos (dojos) {
    return _.filter(dojos, function (dojo) {
      return (dojo.stage !== 4);
    });
  }

  function searchBounds(location, bounds, search) {
    var boundsRadius = getBoundsRadius(bounds);
    cdDojoService.searchBoundingBox({lat: location.lat(), lon: location.lng(), radius: boundsRadius, search: search}).then(function (result) {
      result = filterInactiveDojos(result);
      if (result.length > 0) {
        if(result.length === 1){
          $scope.model.map.setCenter({lat: result[0].geo_point.lat, lng: result[0].geo_point.lon});
          $scope.model.map.setZoom(14);
        } else {
          $scope.model.map.fitBounds(bounds);
        }
        $scope.searchResult = result;

      } else {
        $scope.searchResult = true;
        $scope.noResultsFound = $translate.instant('No Dojos match your search query.');
      }
    });
  }

  function searchNearest(location, search) {
    cdDojoService.searchNearestDojos({lat: location.lat(), lon: location.lng(), search:search}).then(function (result) {
      result = filterInactiveDojos(result);
      if(result.length > 0) {
        $scope.searchResult = result;
      }
      var bounds = new google.maps.LatLngBounds();
      _.each(result, function (dojo) {
        var position = new google.maps.LatLng(dojo.geoPoint && dojo.geoPoint.lat || dojo.geo_point.lat, dojo.geoPoint && dojo.geoPoint.lon || dojo.geo_point.lon)
        bounds.extend(position);
      });
      $scope.model.map.fitBounds(bounds);
    });
  }

  function addMarkersToMap(dojos) {
    return $q(function(resolve, reject) {
      if (markerClusterer) markerClusterer.clearMarkers();
      _.each(dojos, function (dojo) {
        if (dojo.geoPoint || dojo.geo_point) {
          var pinColor = dojo.private === 1 ? 'FF0000' : '008000';
          var marker = new google.maps.Marker({
            map: $scope.model.map,
            dojoName: dojo.name,
            dojoId: dojo.id,
            icon: 'img/marker' + pinColor +'.png',
            position: new google.maps.LatLng(dojo.geoPoint && dojo.geoPoint.lat || dojo.geo_point.lat, dojo.geoPoint && dojo.geoPoint.lon || dojo.geo_point.lon)
          });
          marker.dojo = dojo;
          $scope.markers.push(marker);
        }
      });
      markerClusterer = new MarkerClusterer($scope.model.map, $scope.markers, {imagePath:'components/google-maps-utility-library-v3/markerclusterer/images/m'});
      resolve(markerClusterer);
    });
  }

  function setZoom() {
    if (_.isEmpty($scope.search.dojo)) {
      var zoom = 14, set = false;
      $scope.model.map.setZoom(zoom);
      $scope.model.map.setCenter($scope.pos);
      while (zoom > 2 && !set && $scope.pos !== centerLocation) {
        zoom--;
        _.each($scope.markers, function (marker){
          if ($scope.model.map.getBounds().contains(marker.getPosition())){
            set = true
          }
        });
        $scope.model.map.setZoom(zoom);
      }
      if ($scope.pos === centerLocation) {
        zoom = 2;
      }
      $scope.model.map.setZoom(zoom);
    }
  }

  function getBoundsRadius(bounds) {
    var center = bounds.getCenter();
    var northEast = bounds.getNorthEast();
    var earthRadius = 3963.0;
    var lat1 = center.lat() / 57.2958;
    var lon1 = center.lng() / 57.2958;
    var lat2 = northEast.lat() / 57.2958;
    var lon2 = northEast.lng() / 57.2958;
    var distanceInMiles = earthRadius * Math.acos(Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1));
    return distanceInMiles * 1609.34 //convert to meters
  }

}

angular.module('cpZenPlatform')
  .controller('dojos-map-controller',
  ['$scope', '$window', '$state', '$stateParams', '$translate', '$geolocation',
   '$q', '$location', 'cdDojoService', '$anchorScroll', '$timeout',
   'gmap', 'Geocoder', 'atomicNotifyService', 'usSpinnerService', 'dojoUtils', cdDojosMapCtrl]);
