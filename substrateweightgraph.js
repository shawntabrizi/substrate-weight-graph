const { WsProvider, ApiPromise } = polkadotApi;

// Global Variables
var global = {
    weights: [],
    pointCount: 200,
    blockHashes: [],
    endpoint: ''
};

// Get the first block for the graph
async function getFirstBlock() {
    try {
        return 1;
    } catch (error) {
        console.error(error);
    }
}

// Update window URL to contain querystring, making it easy to share
function updateUrl(startBlock, endBlock) {
    var url = [location.protocol, '//', location.host, location.pathname].join(
        ''
    );
    url +=
        '?endpoint=' + global.endpoint + '&start=' + startBlock + '&end=' + endBlock;
    window.history.replaceState({ path: url }, '', url);
}

// Given a range of blocks, query the Substrate blockchain for the weight across that range
async function getWeightInRange(startBlock, endBlock) {
    //Update UX with Start and End Block
    document.getElementById('startBlock').value = startBlock;
    document.getElementById('endBlock').value = endBlock;

    //Update window URL
    updateUrl(startBlock, endBlock);

    // Calculate the step size given the range of blocks and the number of points we want
    var step = Math.floor((endBlock - startBlock) / global.pointCount);
    // Make sure step is at least 1
    if (step < 1) {
        step = 1;
    }

    // Tell the user the data is loading...
    document.getElementById('output').innerHTML = 'Loading';

    try {
        var promises = [];

        // Get all block hashes
        for (let i = startBlock; i < endBlock; i = i + step) {
            if (!global.blockHashes.find(x => x.block == i)) {
                let blockHashPromise = substrate.rpc.chain.getBlockHash(i);
                promises.push(i, blockHashPromise);
            }
        }

        var results = await Promise.all(promises);

        for (let i = 0; i < results.length; i = i + 2) {
            global.blockHashes.push({
                block: results[i],
                hash: results[i + 1]
            });
        }

        var promises = [];

        // Loop over the blocks, using the step value
        for (let i = startBlock; i < endBlock; i = i + step) {
            // If we already have data about that block, skip it
            if (!global.weights.find(x => x.block == i)) {
                // Get the block hash
                let blockHash = global.blockHashes.find(x => x.block == i).hash;
                // Create a promise to query the weight for that block
                let weightPromise = substrate.query.system.blockWeight.at(blockHash);
                // Create a promise to get the timestamp for that block
                let timePromise = substrate.query.timestamp.now.at(blockHash);
                // Push data to a linear array of promises to run in parallel.
                promises.push(i, weightPromise, timePromise);
            }
        }

        // Call all promises in parallel for speed, result is array of {block: <block>, weight: <weight>, timestamp: <time>}
        var results = await Promise.all(promises);

        // Restructure the data into an array of objects
        var weights = [];
        for (let i = 0; i < results.length; i = i + 3) {
            let block = results[i];
            let weight = results[i + 1];
            console.log(weight.toHuman());
            let normal = weight.normal.toNumber();
            let operational = weight.operational.toNumber();
            let mandatory = weight.mandatory.toNumber();
            let total = normal + operational + mandatory;
            let time = new Date(results[i + 2].toNumber());

            weights.push({
                block: block,
                weight: total,
                normal: normal,
                operational: operational,
                mandatory: mandatory,
                time: time
            });
        }

        //Remove loading message
        document.getElementById('output').innerHTML = '';

        return weights;
    } catch (error) {
        document.getElementById('output').innerHTML = error;
    }
}

// Unpack a multi-dimensional object
function unpack(rows, index) {
    return rows.map(function (row) {
        return row[index];
    });
}

function createTraces(weights) {
    // Create the trace we are going to plot
    var total = {
        type: 'scatter',
        mode: 'lines',
        x: unpack(weights, 'block'),
        y: unpack(weights, 'weight'),
        hoverinfo: 'y+text',
        text: unpack(weights, 'time'),
        name: 'Total'
    };

    var normal = {
        type: 'scatter',
        mode: 'lines',
        x: unpack(weights, 'block'),
        y: unpack(weights, 'normal'),
        hoverinfo: 'y+text',
        text: unpack(weights, 'time'),
        name: 'Normal'
    };

    var operational = {
        type: 'scatter',
        mode: 'lines',
        x: unpack(weights, 'block'),
        y: unpack(weights, 'operational'),
        hoverinfo: 'y+text',
        text: unpack(weights, 'time'),
        name: 'Operational'
    };

    var mandatory = {
        type: 'scatter',
        mode: 'lines',
        x: unpack(weights, 'block'),
        y: unpack(weights, 'mandatory'),
        hoverinfo: 'y+text',
        text: unpack(weights, 'time'),
        name: 'Mandatory'
    };

    var max_weight = {
        type: 'scatter',
        mode: 'lines',
        x: unpack(weights, 'block'),
        y: Array(weights.length).fill(
            (substrate.consts.system.blockWeights
                ? substrate.consts.system.blockWeights.maxBlock // new style
                : substrate.consts.system.maximumBlockWeight    // old style
            ).toNumber()
        ),
        hoverinfo: 'y+text',
        text: unpack(weights, 'time'),
        name: 'Max Weight'
    };

    return [max_weight, total, normal, operational, mandatory]
}

// Create the plotly.js graph
function createGraph(weights) {

    let traces = createTraces(weights);

    // Settings for the graph
    var layout = {
        title: 'Weight per Block',
        xaxis: {
            rangeslider: {},
            type: 'linear',
            title: 'Block'
        },
        yaxis: {
            type: 'linear',
            title: 'Weight'
        }
    };

    Plotly.newPlot('graph', traces, layout);
}

// Sort function for sort by block value
function sortBlock(a, b) {
    return a.block - b.block;
}

// When the graph is zoomed in, get more data points for that range
$('#graph').on('plotly_relayout', async function (eventdata) {
    // Get the new block range from the eventdata from the resize
    var startBlock = Math.floor(eventdata.target.layout.xaxis.range[0]);
    var endBlock = Math.ceil(eventdata.target.layout.xaxis.range[1]);

    // Get new weight data, and concatenate it to the existing data
    global.weights = global.weights.concat(
        await getWeightInRange(startBlock, endBlock)
    );

    // Sort the data by block number for Plotly.js, since it is a scatter plot
    global.weights.sort(sortBlock);

    // Create a new trace with new data
    var traces = createTraces(global.weights);

    // Add new trace, then remove the old one... is there a better way to do this?
    for (let i = 0; i < 4; i++) {
        Plotly.deleteTraces('graph', [0]);
    }

    Plotly.addTraces('graph', traces);
});

//Reset the page
function reset() {
    document.getElementById('output').innerHTML = '';
    Plotly.purge('graph');
    global.weights = [];
    global.blockHashes = [];
}

// Connect to Substrate endpoint
async function connect() {
    let endpoint = document.getElementById('endpoint').value;
    if (!window.substrate || global.endpoint != endpoint) {
        const provider = new WsProvider(endpoint);
        document.getElementById('output').innerHTML = 'Connecting to Endpoint...';
        window.substrate = await ApiPromise.create({
            provider,
            types: {
                ConsumedWeight: { normal: 'u64', operational: 'u64', mandatory: 'u64' },
            }
        });
        global.endpoint = endpoint;
        document.getElementById('output').innerHTML = 'Connected';
    }
}

// Main function
async function graphWeight() {
    try {
        reset();
        await connect();

        // Find the intial range, from first block to current block
        var startBlock, endBlock;

        // blocks per day for 6 second blockchains
        const DAY = 10 * 60 * 24;
        const WEEK = 7 * DAY;

        if (document.getElementById('endBlock').value) {
            endBlock = parseInt(document.getElementById('endBlock').value);
        } else {
            endBlock = parseInt(await substrate.derive.chain.bestNumber());
            console.log('End Block:', endBlock);
        }

        if (document.getElementById('startBlock').value) {
            startBlock = parseInt(document.getElementById('startBlock').value);
        } else {
            startBlock = parseInt(endBlock - WEEK);
        }

        // Check that the range is valid
        if (startBlock >= 0 && startBlock < endBlock) {
            // Get the weights from that range, store in global variable
            global.weights = await getWeightInRange(
                startBlock,
                endBlock
            );
            console.log('Weights', global.weights);
            if (global.weights) {
                // Create the graph
                createGraph(global.weights);
            } else {
                document.getElementById('output').innerHTML =
                    `Couldn't fetch weight values!`;
            }
        } else {
            document.getElementById('output').innerHTML =
                'Invalid block range.';
        }
    } catch (error) {
        document.getElementById('output').innerHTML = error;
    }
}

// Detect Querystrings
function parseQueryStrings() {
    var queryStrings = {};
    //Parse URL
    var url = window.location.search.substring(1);
    if (url) {
        //split querystrings
        var pairs = url.split('&');
        for (pair in pairs) {
            pairArray = pairs[pair].split('=');
            queryStrings[pairArray[0]] = pairArray[1];
        }
    }

    return queryStrings;
}

// On load, check if querystrings are present
window.onload = async function () {
    await connect();
    // Check for querystrings
    var queryStrings = parseQueryStrings();
    // Set starting block
    if (queryStrings['start']) {
        document.getElementById('startBlock').value = queryStrings['start'];
    }
    // Set endpoint
    if (queryStrings['endpoint']) {
        document.getElementById('endpoint').value = queryStrings['endpoint'];
        await graphWeight();
    }
    // Set ending block
    if (queryStrings['end']) {
        document.getElementById('endBlock').value = queryStrings['end'];
    }
    // Adjust range to be what the querystring wants
    if (queryStrings['start'] || queryStrings['end']) {
        Plotly.relayout('graph', 'xaxis.range', [
            document.getElementById('startBlock').value,
            document.getElementById('endBlock').value
        ]);
    }
};
