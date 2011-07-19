/* -*- Mode: js; js-indent-level: 2; -*- */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla Source Map.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Nick Fitzgerald <nfitzgerald@mozilla.com> (original author)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */
define(function (require, exports, module) {

  var util = require('source-map/util');
  var binarySearch = require('source-map/binary-search');
  var ArraySet = require('source-map/array-set').ArraySet;
  var base64VLQ = require('source-map/base64-vlq');

  // TODO: Sometime in the future, if we decide we need to be able to query
  // where in the generated source a peice of the original code came from, we
  // may want to add a slot `_originalMappings` which would be an object keyed
  // by the original source and whose value would be an array of mappings
  // ordered by original line/col rather than generated (which is what we have
  // now in `_generatedMappings`).

  /**
   * A SourceMapConsumer instance represents a parsed source map which we can
   * query for information about the original file positions by giving it a file
   * position in the generated source.
   */
  function SourceMapConsumer (sourceMap) {
    if ( typeof sourceMap === 'string' ) {
      sourceMap = JSON.parse(sourceMap);
    }

    var version = util.getArg(sourceMap, 'version');
    var sources = util.getArg(sourceMap, 'sources');
    var names = util.getArg(sourceMap, 'names');
    var sourceRoot = util.getArg(sourceMap, 'sourceRoot', null);
    var mappings = util.getArg(sourceMap, 'mappings');
    var file = util.getArg(sourceMap, 'file');

    if ( version !== this._version ) {
      throw new Error('Unsupported version: ' + version);
    }

    this._names = ArraySet.fromArray(names);
    this._sources = ArraySet.fromArray(sources);
    this._generatedMappings = [];
    // TODO: this._originalMappings?
    this._parseMappings(mappings, sourceRoot);
  }

  SourceMapConsumer.prototype._version = 3;

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (an ordered list in this._generatedMappings).
   */
  SourceMapConsumer.prototype._parseMappings =
    function SourceMapConsumer_parseMappings (str, sourceRoot) {
      var generatedLine = 1;
      var previousGeneratedColumn = 0;
      var previousOriginalLine = 0;
      var previousOriginalColumn = 0;
      var previousSource = 0;
      var previousName = 0;
      var mappingSeparator = /^[,;]/;
      var mapping;
      var temp;

      while (str.length > 0) {
        if ( str.charAt(0) === ';' ) {
          generatedLine++;
          str = str.slice(1);
          previousGeneratedColumn = 0;
        }
        else if ( str.charAt(0) === ',' ) {
          str = str.slice(1);
        }
        else {
          mapping = {};
          mapping.generatedLine = generatedLine;

          // Generated column.
          temp = base64VLQ.decode(str);
          mapping.generatedColumn = previousGeneratedColumn + temp.value;
          previousGeneratedColumn = mapping.generatedColumn;
          str = temp.rest;

          if ( ! mappingSeparator.test(str.charAt(0)) ) {
            // Original source.
            temp = base64VLQ.decode(str);
            if ( sourceRoot ) {
              mapping.source = util.join(sourceRoot, this._sources.at(previousSource + temp.value));
            }
            else {
              mapping.source = this._sources.at(previousSource + temp.value);
            }
            previousSource += temp.value;
            str = temp.rest;

            // Original line.
            temp = base64VLQ.decode(str);
            mapping.originalLine = previousOriginalLine + temp.value;
            previousOriginalLine = mapping.originalLine;
            str = temp.rest;

            // Original column.
            temp = base64VLQ.decode(str);
            mapping.originalColumn = previousOriginalColumn + temp.value;
            previousOriginalColumn = mapping.originalColumn;
            str = temp.rest;

            if ( ! mappingSeparator.test(str.charAt(0)) ) {
              // Original name.
              temp = base64VLQ.decode(str);
              mapping.name = this._names.at(previousName + temp.value);
              previousName += temp.value;
              str = temp.rest;
            }
          }

          this._generatedMappings.push(mapping);
          // TODO: insert in to this._originalMappings[mapping.source]?
        }
      }
    };

  /**
   * Returns the original source, line, and column information for the generated
   * source's line and column positions provided. The only argument is an object
   * with the following properties:
   *
   *   - line: The line number in the generated source.
   *   - column: The column number in the generated source.
   *
   * and an object is returned with the following properties:
   *
   *   - source: The original source file, or null.
   *   - line: The line number in the original source, or null.
   *   - column: The column number in the original source, or null.
   *   - name: The original identifier, or null.
   */
  SourceMapConsumer.prototype.originalPositionFor =
    function SourceMapConsumer_originalPositionFor (args) {
      var needle = {
        generatedLine: util.getArg(args, 'line'),
        generatedColumn: util.getArg(args, 'column')
      };

      function compare (a, b) {
        var cmp = a.generatedLine - b.generatedLine;
        return cmp === 0
          ? a.generatedColumn - b.generatedColumn
          : cmp;
      }

      var mapping = binarySearch.search(needle, this._generatedMappings, compare);

      if ( mapping ) {
        return {
          source: util.getArg(mapping, 'source', null),
          line: util.getArg(mapping, 'originalLine', null),
          column: util.getArg(mapping, 'originalColumn', null),
          name: util.getArg(mapping, 'name', null)
        };
      }
      else {
        return {
          source: null,
          line: null,
          column: null,
          name: null
        };
      }
    };

  // TODO: SourceMapConsumer.prototype.generatedPositionFor using this._originalMappings?

  exports.SourceMapConsumer = SourceMapConsumer;

});