export const WEBRTSP_0_2 = 2;

const names =
{
    [WEBRTSP_0_2] : "WEBRTSP/0.2",
}

export function Name(protocol)
{
    return names[protocol];
}

export function Parse(token)
{
    if(token.empty)
        return undefined;

    for(let key in names) {
        if(names[key].length == token.length &&
           token.startsWith(names[key]))
        {
            return ~~key;
        }
    }

    return undefined;
}
