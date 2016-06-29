'use strict';
var Cesium = require('cesium');
var AxisAlignedBoundingBox = Cesium.AxisAlignedBoundingBox;
var Cartesian3 = Cesium.Cartesian3;
var DeveloperError = Cesium.DeveloperError;
var triangleAxisAlignedBoundingBoxOverlap = require('./triangleAxisAlignedBoundingBoxOverlap');
var clone = require('clone');

module.exports = StaticUniformGrid;

/**
 * A Uniform Grid for unmoving objects.
 * @alias StaticUniformGrid
 * @constructor
 *
 * @param {Object[]} objects Objects that the grid should store.
 * @param {Function} aabbFunction A function for checking the axis aligned bounding box of an object in space.
 *                   This function should expect to take an object and a `min` and `max` Cartesian3. It should update
 *                   `min` and `max` in place.
 * @param {Function} cellCheckFunction A function for checking if an object intersects a grid cell, given as 2 Cartesian3s.
 *                   This function should expect to take an object and the bounding cell's `min` and cell width. It should
 *                   return `true` if the object intersects with the cell at all and `false` otherwise.
 * @param {Number} cellWidth, The cell width of the uniform grid.
 */

var minScratch = new Cartesian3();
var maxScratch = new Cartesian3();

function StaticUniformGrid(data, cellWidth, objectAABBFunction, cellCheckFunction) {

    /**
     * The width of a single cell.
     * @type {Number}
     */
    this.cellWidth = cellWidth;

    /**
     * The axis aligned bounding box of the grid
     * @type {AxisAlignedBoundingBox}
     */
    this.AABB = new AxisAlignedBoundingBox();

    /**
     * The cell count in each dimension.
     * @type {Cartesian3}
     */
    this.resolution = new Cartesian3();

    /**
     * Start index for each cell's data within the data array.
     * @type {Number[]}
     */
    this.cellIndices = [];

    /**
     * Count for each cell's data within the data array.
     * @type {Number[]}
     */
    this.cellCounts = [];

    /**
     * Array of objects
     * @type {Array}
     */
    this.data = [];

    ////// Populate //////
    var min = this.AABB.minimum;
    var max = this.AABB.maximum;
    var center = this.AABB.center;
    min.x = Number.POSITIVE_INFINITY;
    min.y = Number.POSITIVE_INFINITY;
    min.z = Number.POSITIVE_INFINITY;
    max.x = Number.NEGATIVE_INFINITY;
    max.y = Number.NEGATIVE_INFINITY;
    max.z = Number.NEGATIVE_INFINITY;

    var resolution = this.resolution;

    // Find the min/max bounds and resolution of the uniform grid
    var objectCount = data.length;
    for (var i = 0; i < objectCount; i++) {
        objectAABBFunction(data[i], min, max);
    }

    // Figure out what the grid's resolution should be. Pad min and max out to match
    resolution.x = Math.floor((max.x - min.x) / cellWidth) + 1;
    resolution.y = Math.floor((max.y - min.y) / cellWidth) + 1;
    resolution.z = Math.floor((max.z - min.z) / cellWidth) + 1;

    center = Cartesian3.add(min, max, center);
    center = Cartesian3.divideByScalar(center, 2.0, center);
    min.x = center.x - (resolution.x / 2.0) * cellWidth;
    min.y = center.y - (resolution.y / 2.0) * cellWidth;
    min.z = center.z - (resolution.z / 2.0) * cellWidth;
    max.x = center.x + (resolution.x / 2.0) * cellWidth;
    max.y = center.y + (resolution.y / 2.0) * cellWidth;
    max.z = center.z + (resolution.z / 2.0) * cellWidth;

    var cellCount = resolution.x * resolution.y * resolution.z;

    // Bin the objects
    var allCellData = [];
    for (i = 0; i < cellCount; i++) {
        allCellData.push({
            itemCount : 0,
            items : []
        });
    }

    var parameters = {
        allCellData : allCellData,
        cellCheckFunction : cellCheckFunction,
        grid : this,
        item : undefined
    };

    //For each object:
    for (i = 0; i < objectCount; i++) {
        var item = data[i];

        // Get the object's AABB
        minScratch.x = Math.POSITIVE_INFINITY;
        minScratch.y = Math.POSITIVE_INFINITY;
        minScratch.z = Math.POSITIVE_INFINITY;
        maxScratch.x = Math.NEGATIVE_INFINITY;
        maxScratch.y = Math.NEGATIVE_INFINITY;
        maxScratch.z = Math.NEGATIVE_INFINITY;
        objectAABBFunction(item, minScratch, maxScratch);

        // Step over the cells in the AABB, checking for each cell if the object intersects this cell
        parameters.item = item;
        StaticUniformGrid.boundingBoxMarch(this, minScratch, maxScratch, binObject, parameters);
    }

    // Store all the object copies in one contiguous array for better spatial locality
    var cellItems = this.data;
    var cellIndices = this.cellIndices;
    var cellCounts = this.cellCounts;

    var firstFreeIndex = 0;
    for (i = 0; i < cellCount; i++) {
        var cellData = allCellData[i];
        var itemCount = cellData.itemCount;
        var items = cellData.items;
        cellIndices.push(firstFreeIndex);
        cellCounts.push(itemCount);
        for (var j = 0; j < itemCount; j++) {
            cellItems.push(clone(items[j]))
        }
    }
}


var cellMarchScratch = new Cartesian3();
StaticUniformGrid.boundingBoxMarch = function(grid, min, max, marchFunction, parameters) {
    var stepWidth = grid.cellWidth;
    var gridMin = grid.AABB.minimum;

    // Compute the minimum coordinate of the first cell
    var xStart = Math.floor((min.x - gridMin.x) / stepWidth) * stepWidth + gridMin.x;
    var yStart = Math.floor((min.y - gridMin.y) / stepWidth) * stepWidth + gridMin.y;
    cellMarchScratch.z = Math.floor((min.z - gridMin.z) / stepWidth) * stepWidth + gridMin.z;


    // Compute the number of cells that min and max cover in each dimension.
    var xCount = Math.floor((max.x - min.x) / stepWidth) + 1;
    var yCount = Math.floor((max.y - min.y) / stepWidth) + 1;
    var zCount = Math.floor((max.z - min.z) / stepWidth) + 1;

    // March over the cells that the grid covers.
    for (var z = 0; z < zCount; z++) {
        cellMarchScratch.y = yStart;
        for (var y = 0; y < yCount; y++) {
            cellMarchScratch.x = xStart;
            for (var x = 0; x < xCount; x++) {
                marchFunction(parameters, cellMarchScratch, stepWidth);
                cellMarchScratch.x += stepWidth;
            }
            cellMarchScratch.y += stepWidth;
        }
        cellMarchScratch.z += stepWidth;
    }
};

StaticUniformGrid.indexOfPosition = function(grid, position) {
    var min = grid.AABB.minimum;
    var cellWidth = grid.cellWidth;
    var resolution = grid.resolution;
    var x = Math.floor((position.x - min.x) / cellWidth);
    var y = Math.floor((position.y - min.y) / cellWidth);
    var z = Math.floor((position.z - min.z) / cellWidth);
    return x + y * resolution.x + z * resolution.x * resolution.y;
};

var binObjectScratch = new Cartesian3();
function binObject(parameters, corner, stepWidth) {
    var item = parameters.item;
    var cellCheckFunction = parameters.cellCheckFunction;

    // Check if this item overlaps the cell. If not, return.
    if (!cellCheckFunction(item, corner, stepWidth)) {
        return;
    }

    // Bin
    binObjectScratch.x = corner.x + stepWidth / 2.0;
    binObjectScratch.y = corner.y + stepWidth / 2.0;
    binObjectScratch.z = corner.z + stepWidth / 2.0;

    var index = StaticUniformGrid.indexOfPosition(parameters.grid, binObjectScratch);
    var cellData = parameters.allCellData[index];
    cellData.itemCount++;
    cellData.items.push(item);
}

StaticUniformGrid.forEachNeighbor = function(grid, position, neighborFunction, parameters) {

};

function triangleAABB(triangle, min, max) {
    min.x = Math.min(triangle[0].x, min.x);
    min.y = Math.min(triangle[0].y, min.y);
    min.z = Math.min(triangle[0].z, min.z);
    max.x = Math.max(triangle[0].x, max.x);
    max.y = Math.max(triangle[0].y, max.y);
    max.z = Math.max(triangle[0].z, max.z);

    min.x = Math.min(triangle[1].x, min.x);
    min.y = Math.min(triangle[1].y, min.y);
    min.z = Math.min(triangle[1].z, min.z);
    max.x = Math.max(triangle[1].x, max.x);
    max.y = Math.max(triangle[1].y, max.y);
    max.z = Math.max(triangle[1].z, max.z);

    min.x = Math.min(triangle[2].x, min.x);
    min.y = Math.min(triangle[2].y, min.y);
    min.z = Math.min(triangle[2].z, min.z);
    max.x = Math.max(triangle[2].x, max.x);
    max.y = Math.max(triangle[2].y, max.y);
    max.z = Math.max(triangle[2].z, max.z);
}

var triangleCheckScratch = new Cartesian3();
var halfDimensionsScratch = new Cartesian3();
var aabbScratch = new AxisAlignedBoundingBox();
function triangleCellCheck(triangle, cellMin, cellWidth) {
    var halfWidth = cellWidth / 2.0;
    var center = aabbScratch.center;
    var maximum = aabbScratch.maximum;

    halfDimensionsScratch.x = halfWidth;
    halfDimensionsScratch.y = halfWidth;
    halfDimensionsScratch.z = halfWidth;

    triangleCheckScratch.x = cellMin.x + halfWidth;
    triangleCheckScratch.y = cellMin.y + halfWidth;
    triangleCheckScratch.z = cellMin.z + halfWidth;

    aabbScratch.minimum = cellMin;
    center.x = cellMin.x + cellWidth;
    center.y = cellMin.y + cellWidth;
    center.z = cellMin.z + cellWidth;
    maximum.x = center.x + cellWidth;
    maximum.y = center.y + cellWidth;
    maximum.z = center.z + cellWidth;

    return triangleAxisAlignedBoundingBoxOverlap(aabbScratch, triangle);
}