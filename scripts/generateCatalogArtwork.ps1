$ErrorActionPreference = "Stop"
$backendRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $backendRoot "public\catalog-images"
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$nodeScript = @'
const groups = require('./seed/verifiedListings');
const images = require('./seed/listingImageSources');
const slug = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const results = [];
for (const group of groups) for (const item of group.items) {
  const key = 'suvyatra:v1:' + group.collection + ':' + (item.module ? item.module + ':' : '') + slug(item.name);
  if (!images[key]) results.push({ key, category: item.module || group.collection, name: item.name, location: item.location || item.city || 'Nepal' });
}
process.stdout.write(JSON.stringify(results));
'@

Push-Location $backendRoot
try {
  $manifestJson = & node -e $nodeScript
  if ($LASTEXITCODE -ne 0) { throw "Could not read the verified listing manifest." }
} finally {
  Pop-Location
}
$entries = $manifestJson | ConvertFrom-Json

Add-Type -AssemblyName System.Drawing
$renderer = @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

public static class SuvYatraCatalogArtwork {
  private static readonly Color[] Colors = {
    Color.FromArgb(24, 116, 139), Color.FromArgb(190, 103, 52),
    Color.FromArgb(85, 124, 82), Color.FromArgb(106, 94, 157),
    Color.FromArgb(174, 84, 105), Color.FromArgb(58, 119, 166),
    Color.FromArgb(169, 131, 53), Color.FromArgb(63, 132, 119)
  };

  public static void Render(string file, string category, string name, string location, int index) {
    const int width = 640, height = 360;
    using (var bitmap = new Bitmap(width, height))
    using (var graphics = Graphics.FromImage(bitmap)) {
      graphics.SmoothingMode = SmoothingMode.AntiAlias;
      graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
      Color accent = Colors[index % Colors.Length];
      using (var sky = new LinearGradientBrush(new Rectangle(0, 0, width, height), Color.FromArgb(224, 240, 239), Color.FromArgb(250, 239, 216), 90f)) {
        graphics.FillRectangle(sky, 0, 0, width, height);
      }
      using (var far = new SolidBrush(Color.FromArgb(176, 201, 190))) {
        Point[] mountains = { new Point(0, 198), new Point(94, 84 + index % 19), new Point(185, 194), new Point(302, 72 + index % 23), new Point(442, 195), new Point(542, 111 + index % 17), new Point(640, 188), new Point(640, 281), new Point(0, 281) };
        graphics.FillPolygon(far, mountains);
      }
      using (var ground = new SolidBrush(Color.FromArgb(222, 227, 207))) graphics.FillRectangle(ground, 0, 200, width, 160);
      DrawScene(graphics, category.ToLowerInvariant(), name, location, accent, index);
      using (var shade = new SolidBrush(Color.FromArgb(226, 17, 39, 55))) graphics.FillRectangle(shade, 0, 286, width, 74);
      using (var titleFont = new Font("Arial", 17, FontStyle.Bold))
      using (var noteFont = new Font("Arial", 9, FontStyle.Bold))
      using (var white = new SolidBrush(Color.White))
      using (var muted = new SolidBrush(Color.FromArgb(222, 232, 234))) {
        var titleBox = new RectangleF(22, 294, 596, 31);
        graphics.DrawString("Illustration: " + name, titleFont, white, titleBox);
        graphics.DrawString("CATEGORY ART  |  NOT A PHOTOGRAPH OF THE LISTED SITE", noteFont, muted, new RectangleF(23, 332, 594, 18));
      }
      bitmap.Save(file, ImageFormat.Png);
    }
  }

  public static void RenderNepalTripPlanner(string file) {
    const int width = 640, height = 360;
    using (var bitmap = new Bitmap(width, height))
    using (var graphics = Graphics.FromImage(bitmap)) {
      graphics.SmoothingMode = SmoothingMode.AntiAlias;
      graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
      using (var sky = new LinearGradientBrush(new Rectangle(0, 0, width, height), Color.FromArgb(218, 239, 237), Color.FromArgb(249, 233, 208), 90f)) {
        graphics.FillRectangle(sky, 0, 0, width, height);
      }
      using (var far = new SolidBrush(Color.FromArgb(138, 176, 169))) {
        graphics.FillPolygon(far, new[] {
          new Point(0, 226), new Point(111, 91), new Point(217, 222),
          new Point(343, 66), new Point(487, 224), new Point(568, 121),
          new Point(640, 212), new Point(640, 360), new Point(0, 360)
        });
      }
      using (var snow = new SolidBrush(Color.FromArgb(250, 252, 246))) {
        graphics.FillPolygon(snow, new[] { new Point(86, 122), new Point(111, 91), new Point(139, 126), new Point(113, 117) });
        graphics.FillPolygon(snow, new[] { new Point(305, 113), new Point(343, 66), new Point(384, 116), new Point(347, 101) });
        graphics.FillPolygon(snow, new[] { new Point(544, 151), new Point(568, 121), new Point(594, 155), new Point(570, 146) });
      }
      using (var near = new SolidBrush(Color.FromArgb(82, 133, 105))) {
        graphics.FillPolygon(near, new[] {
          new Point(0, 257), new Point(105, 211), new Point(208, 265),
          new Point(347, 200), new Point(476, 268), new Point(582, 213),
          new Point(640, 245), new Point(640, 360), new Point(0, 360)
        });
      }
      using (var route = new Pen(Color.FromArgb(225, 128, 67), 5))
      using (var routeDot = new SolidBrush(Color.FromArgb(225, 128, 67))) {
        route.DashStyle = DashStyle.Dash;
        graphics.DrawLines(route, new[] {
          new Point(40, 302), new Point(140, 277), new Point(230, 300),
          new Point(322, 272), new Point(390, 283)
        });
        foreach (var point in new[] { new Point(40, 302), new Point(140, 277), new Point(230, 300), new Point(322, 272) }) {
          graphics.FillEllipse(routeDot, point.X - 6, point.Y - 6, 12, 12);
        }
      }
      using (var card = new SolidBrush(Color.FromArgb(247, 250, 246)))
      using (var cardLine = new Pen(Color.FromArgb(203, 219, 211), 2))
      using (var ink = new SolidBrush(Color.FromArgb(44, 65, 74)))
      using (var muted = new SolidBrush(Color.FromArgb(102, 125, 125)))
      using (var accent = new SolidBrush(Color.FromArgb(24, 116, 139)))
      using (var cardTitle = new Font("Arial", 12, FontStyle.Bold))
      using (var rowFont = new Font("Arial", 9, FontStyle.Bold)) {
        graphics.FillRectangle(card, 407, 151, 194, 126);
        graphics.DrawRectangle(cardLine, 407, 151, 194, 126);
        graphics.DrawString("YOUR ITINERARY", cardTitle, ink, new PointF(421, 164));
        graphics.DrawString("Places / routes / days", rowFont, muted, new PointF(421, 187));
        for (int row = 0; row < 3; row++) {
          int y = 213 + row * 18;
          graphics.FillEllipse(accent, 422, y, 9, 9);
          graphics.FillRectangle(muted, 439, y + 1, 122 - row * 13, 7);
        }
      }
      using (var shade = new SolidBrush(Color.FromArgb(226, 17, 39, 55)))
      using (var titleFont = new Font("Arial", 17, FontStyle.Bold))
      using (var noteFont = new Font("Arial", 9, FontStyle.Bold))
      using (var white = new SolidBrush(Color.White))
      using (var muted = new SolidBrush(Color.FromArgb(222, 232, 234))) {
        graphics.FillRectangle(shade, 0, 286, width, 74);
        graphics.DrawString("Nepal trip planning", titleFont, white, new RectangleF(22, 294, 596, 31));
        graphics.DrawString("PROJECT-OWNED TRAVEL ILLUSTRATION  |  NOT A PHOTOGRAPH", noteFont, muted, new RectangleF(23, 332, 594, 18));
      }
      bitmap.Save(file, ImageFormat.Png);
    }
  }

  private static void DrawScene(Graphics g, string category, string name, string location, Color accent, int index) {
    using (var dark = new SolidBrush(Color.FromArgb(44, 65, 74)))
    using (var accentBrush = new SolidBrush(accent))
    using (var pale = new SolidBrush(Color.FromArgb(245, 240, 221)))
    using (var white = new SolidBrush(Color.White))
    using (var line = new Pen(Color.FromArgb(44, 65, 74), 7)) {
      if (category == "restaurant" || category == "restaurants") {
        g.FillRectangle(accentBrush, 180, 127, 280, 145);
        g.FillRectangle(dark, 157, 111, 326, 36);
        for (int x = 164; x < 475; x += 39) {
          g.FillPolygon(white, new[] { new Point(x, 112), new Point(x + 19, 112), new Point(x + 19, 146), new Point(x, 146) });
        }
        g.FillRectangle(pale, 205, 164, 82, 91);
        g.FillRectangle(pale, 319, 164, 112, 53);
        g.FillRectangle(dark, 353, 219, 44, 53);
        g.DrawEllipse(line, 337, 174, 24, 24);
      } else if (category == "transport" || category == "transports") {
        if (name.ToLowerInvariant().Contains("motorbike")) {
          g.DrawEllipse(line, 199, 212, 62, 62); g.DrawEllipse(line, 393, 212, 62, 62);
          g.DrawLine(line, 229, 241, 296, 200); g.DrawLine(line, 296, 200, 344, 240); g.DrawLine(line, 344, 240, 423, 241);
          g.FillRectangle(accentBrush, 278, 176, 74, 28);
        } else {
          int y = name.ToLowerInvariant().Contains("jeep") ? 167 : 181;
          g.FillRectangle(accentBrush, 173, y, 293, 75);
          g.FillPolygon(dark, new[] { new Point(235, y), new Point(276, y - 49), new Point(387, y - 49), new Point(431, y) });
          g.FillRectangle(pale, 285, y - 40, 88, 34);
          g.FillEllipse(dark, 212, 228, 56, 56); g.FillEllipse(dark, 376, 228, 56, 56);
          g.FillEllipse(white, 229, 245, 22, 22); g.FillEllipse(white, 393, 245, 22, 22);
        }
      } else if (category == "activity") {
        string activity = name.ToLowerInvariant();
        if (activity.Contains("paragliding")) {
          using (var wing = new Pen(accent, 18)) g.DrawArc(wing, 195, 112, 250, 148, 190, 160);
          g.DrawLine(line, 240, 177, 312, 241); g.DrawLine(line, 400, 177, 329, 241);
          g.FillEllipse(dark, 304, 229, 20, 20); g.DrawLine(line, 314, 247, 314, 270);
        } else if (activity.Contains("rafting")) {
          using (var wave = new Pen(Color.FromArgb(46, 145, 174), 13)) for (int x=25; x<620; x+=102) g.DrawArc(wave, x, 205 + x % 22, 108, 46, 0, 180);
          g.FillPolygon(accentBrush, new[] { new Point(182, 211), new Point(458, 211), new Point(421, 257), new Point(224, 257) });
          g.DrawLine(line, 275, 166, 244, 225); g.DrawLine(line, 361, 159, 391, 225);
        } else if (activity.Contains("bungee")) {
          g.DrawLine(line, 197, 126, 441, 126); g.DrawLine(line, 219, 126, 198, 205); g.DrawLine(line, 418, 126, 440, 205);
          g.FillEllipse(accentBrush, 313, 166, 28, 28); g.DrawLine(line, 327, 194, 327, 257);
        } else if (activity.Contains("trek")) {
          g.FillPolygon(accentBrush, new[] { new Point(145, 253), new Point(275, 99), new Point(345, 181), new Point(415, 93), new Point(526, 253) });
          g.FillPolygon(white, new[] { new Point(249, 130), new Point(275, 99), new Point(302, 132), new Point(279, 124) });
          g.DrawLine(line, 313, 195, 350, 248); g.DrawLine(line, 339, 239, 365, 239);
        } else if (activity.Contains("zipline")) {
          g.DrawLine(line, 136, 107, 511, 232); g.DrawLine(new Pen(accent, 11), 328, 168, 319, 205);
          g.FillEllipse(dark, 310, 205, 24, 24); g.DrawLine(line, 321, 226, 321, 266);
        } else if (activity.Contains("safari")) {
          g.FillRectangle(accentBrush, 190, 168, 262, 70); g.FillPolygon(dark, new[] { new Point(235, 168), new Point(269, 130), new Point(389, 130), new Point(422, 168) });
          g.FillEllipse(dark, 218, 222, 50, 50); g.FillEllipse(dark, 378, 222, 50, 50);
          g.FillEllipse(white, 369, 115, 38, 38); g.DrawLine(line, 388, 149, 388, 190);
        } else {
          g.FillPolygon(accentBrush, new[] { new Point(142, 228), new Point(286, 111), new Point(438, 228) });
          g.FillRectangle(dark, 275, 176, 25, 52); g.FillPolygon(white, new[] { new Point(286, 111), new Point(255, 184), new Point(286, 170), new Point(317, 184) });
          g.FillPolygon(accentBrush, new[] { new Point(328, 160), new Point(462, 194), new Point(328, 205), new Point(282, 194) });
        }
      } else if (category == "shopping") {
        bool mall = name.ToLowerInvariant().Contains("mall");
        if (mall) {
          g.FillRectangle(accentBrush, 177, 112, 286, 161);
          for (int x=202; x<440; x+=59) g.FillRectangle(pale, x, 140, 39, 49);
          g.FillRectangle(dark, 292, 205, 59, 68);
          g.FillRectangle(dark, 158, 109, 324, 17);
        } else {
          g.FillRectangle(pale, 175, 152, 290, 120);
          g.FillRectangle(accentBrush, 163, 124, 314, 37);
          for (int x=176; x<477; x+=44) g.FillPolygon((x / 44) % 2 == 0 ? white : dark, new[] { new Point(x, 125), new Point(x + 22, 125), new Point(x + 22, 160), new Point(x, 160) });
          for (int x=203; x<444; x+=78) g.FillRectangle(dark, x, 177, 50, 40);
        }
      } else if (category == "petrol") {
        g.FillRectangle(dark, 158, 124, 324, 26);
        g.FillRectangle(accentBrush, 181, 151, 278, 15);
        for (int x=192; x<444; x+=92) {
          g.FillRectangle(pale, x, 166, 65, 102);
          g.DrawRectangle(line, x+11, 179, 42, 48);
          g.FillRectangle(accentBrush, x+18, 191, 27, 9);
          g.DrawLine(line, x+54, 189, x+68, 211);
        }
      } else if (category == "hospital") {
        g.FillRectangle(pale, 187, 103, 266, 170);
        g.FillRectangle(accentBrush, 178, 101, 284, 20);
        for (int x=212; x<431; x+=55) for (int y=136; y<207; y+=46) g.FillRectangle(accentBrush, x, y, 31, 26);
        g.FillRectangle(dark, 292, 219, 55, 54);
        g.FillRectangle(white, 383, 219, 48, 48);
        using (var cross = new SolidBrush(Color.FromArgb(191, 61, 65))) {
          g.FillRectangle(cross, 402, 225, 10, 37);
          g.FillRectangle(cross, 389, 239, 36, 10);
        }
      } else {
        using (var glass = new SolidBrush(Color.FromArgb(181, 216, 220)))
        using (var gold = new SolidBrush(Color.FromArgb(212, 183, 94))) {
          g.FillRectangle(pale, 170, 117, 228, 156);
          g.FillRectangle(accentBrush, 157, 104, 254, 25);
          g.FillRectangle(dark, 199, 151, 169, 104);
          g.FillRectangle(glass, 214, 166, 138, 59);
          g.FillRectangle(accentBrush, 248, 230, 69, 11);
          g.FillRectangle(dark, 432, 161, 57, 112);
          g.FillRectangle(glass, 440, 175, 40, 41);
          g.FillRectangle(dark, 447, 181, 25, 24);
          g.FillRectangle(gold, 449, 247, 19, 8);
        }
      }
      using (var locationFont = new Font("Arial", 10, FontStyle.Bold))
      using (var locationBrush = new SolidBrush(Color.FromArgb(52, 75, 82))) {
        g.DrawString(location, locationFont, locationBrush, new PointF(18, 16));
      }
    }
  }
}
"@
Add-Type -TypeDefinition $renderer -ReferencedAssemblies System.Drawing

$index = 0
foreach ($entry in $entries) {
  $fileName = "$($entry.key -replace ':', '-').png"
  $filePath = Join-Path $outputDirectory $fileName
  [SuvYatraCatalogArtwork]::Render($filePath, $entry.category, $entry.name, $entry.location, $index)
  $index += 1
}

$plannerArtworkPath = Join-Path $outputDirectory "suvyatra-nepal-trip-planner.png"
[SuvYatraCatalogArtwork]::RenderNepalTripPlanner($plannerArtworkPath)

Write-Output "Generated $index unique category illustrations and Nepal trip planner artwork in $outputDirectory."
