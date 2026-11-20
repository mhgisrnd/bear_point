(function (root) {
  "use strict";
  const center = "66 100";
  const rotation = degrees => `rotate(${degrees.toFixed(1)} ${center})`;

  function markup() {
    let dial = "";
    for (let degrees = 0; degrees < 360; degrees += 2) {
      const cardinal = degrees % 90 === 0, major = degrees % 30 === 0;
      const cssClass = cardinal ? ' class="is-cardinal"' : major ? ' class="is-major"' : "";
      const transform = rotation(degrees);
      dial += `<line x1="66" y1="6" x2="66" y2="${cardinal ? 19 : major ? 15 : 11}" transform="${transform}"${cssClass}/>`;
      if (major) dial += `<text x="66" y="25" transform="${transform}">${degrees}</text>`;
    }
    for (const [letter, degrees, cssClass] of [["N", 0, "is-north"], ["E", 90, ""], ["S", 180, "is-south"], ["W", 270, ""]]) {
      dial += `<text x="66" y="37" transform="${rotation(degrees)}" class="is-letter ${cssClass}">${letter}</text>`;
    }
    return dial;
  }

  root.BearHeadingDial = { markup, rotation };
})(window);
