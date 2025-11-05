// Simple test script to verify Wikipedia portrait fetching works
// Run with: node test-wikipedia-portrait.js

const testExperts = [
  'Robert C. Martin',
  'Martin Fowler',
  'Kent Beck',
  'Linus Torvalds',
  'Guido van Rossum',
  'Dan Abramov',
  'Kent C. Dodds',
];

async function fetchWikipediaPortrait(personName) {
  try {
    console.log(`\n🔍 Fetching portrait for: ${personName}`);

    // Step 1: Get page image thumbnail
    const pageImageUrl = new URL('https://en.wikipedia.org/w/api.php');
    pageImageUrl.searchParams.set('action', 'query');
    pageImageUrl.searchParams.set('titles', personName);
    pageImageUrl.searchParams.set('prop', 'pageimages|pageterms');
    pageImageUrl.searchParams.set('format', 'json');
    pageImageUrl.searchParams.set('formatversion', '2');
    pageImageUrl.searchParams.set('pithumbsize', '512');
    pageImageUrl.searchParams.set('origin', '*');

    const pageResponse = await fetch(pageImageUrl.toString());
    const pageData = await pageResponse.json();

    const pages = pageData.query?.pages;
    if (!pages) {
      console.log('  ❌ No Wikipedia page found');
      return null;
    }

    const page = Object.values(pages)[0];
    if (!page?.thumbnail?.source) {
      console.log('  ❌ No thumbnail image found');
      return null;
    }

    const thumbnailUrl = page.thumbnail.source;
    const pageTitle = page.title || personName;

    console.log(`  ✅ Found image: ${thumbnailUrl}`);
    console.log(`  📄 Page title: ${pageTitle}`);

    // Step 2: Get license info
    const imageFileName = page.pageimage;
    if (imageFileName) {
      const imageInfoUrl = new URL('https://en.wikipedia.org/w/api.php');
      imageInfoUrl.searchParams.set('action', 'query');
      imageInfoUrl.searchParams.set('titles', `File:${imageFileName}`);
      imageInfoUrl.searchParams.set('prop', 'imageinfo');
      imageInfoUrl.searchParams.set('iiprop', 'url|extmetadata');
      imageInfoUrl.searchParams.set('format', 'json');
      imageInfoUrl.searchParams.set('origin', '*');

      const infoResponse = await fetch(imageInfoUrl.toString());
      const infoData = await infoResponse.json();

      const infoPages = infoData.query?.pages;
      if (infoPages) {
        const infoPage = Object.values(infoPages)[0];
        const imageInfo = infoPage?.imageinfo?.[0];

        if (imageInfo) {
          const artist = imageInfo.extmetadata?.Artist?.value;
          const license = imageInfo.extmetadata?.LicenseShortName?.value;

          if (artist) {
            const cleanArtist = artist.replace(/<[^>]*>/g, '');
            console.log(`  👤 Artist: ${cleanArtist}`);
          }
          if (license) {
            console.log(`  📜 License: ${license}`);
          }
        }
      }
    }

    return {
      url: thumbnailUrl,
      pageTitle,
    };
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('  Wikipedia Portrait Fetching Test');
  console.log('='.repeat(60));

  let successCount = 0;
  let failCount = 0;

  for (const expertName of testExperts) {
    const result = await fetchWikipediaPortrait(expertName);
    if (result) {
      successCount++;
    } else {
      failCount++;
    }
    // Small delay to be nice to Wikipedia's servers
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`  Results: ${successCount} succeeded, ${failCount} failed`);
  console.log('='.repeat(60));
}

runTests();
