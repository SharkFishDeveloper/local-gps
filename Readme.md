valhalla_build_config --mjolnir-tile-dir valhalla_tiles --mjolnir-tile-extract valhalla_tiles.tar | sed '1s/^\xEF\xBB\xBF//' > valhalla.json

python -m valhalla valhalla_build_tiles -c valhalla.json "../map-data-pbf/delhi.osm.pbf"