import React from "react";
import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";
import Dropdown from "react-bootstrap/esm/Dropdown";
import Container from "react-bootstrap/esm/Container";
import Col from "react-bootstrap/esm/Col";
import Row from "react-bootstrap/esm/Row";
import Spinner from "react-bootstrap/esm/Spinner";
import Table from "react-bootstrap/esm/Table";
import Accordion from "react-bootstrap/esm/Accordion";
import Markdown from "react-markdown";
import semver from "semver";
import Button from "react-bootstrap/esm/Button";
import Modal from "react-bootstrap/esm/Modal";
import { graphql } from "@octokit/graphql";
import Form from "react-bootstrap/esm/Form";

type NpmData = {
  dependencies: Record<string, string>;
  dist: {
    tarball: string;
    unpackedSize: number;
  };
  "dist-tags": Record<string, string>;
  engines: {
    node: string;
  };
  gitHead: string;
  homepage: string;
  name: string;
  oclif: {
    jitPlugins: Record<string, string>;
    plugins: string[];
  };
  repository: {
    type: string;
    url: string;
  };
  time: Record<string, string>;
  version: string;
  versions: string[];
};

type PullRequest = {
  title: string;
  url: string;
  createdAt: string;
  mergedAt: string;
  author: string;
};

function bytesToMB(bytes: number, decimalPlaces = 2): string {
  return `${Number.parseFloat((bytes / 1024 / 1024).toFixed(decimalPlaces))}mb`;
}

function normalizeGitUrl(url: string): string {
  const { host, pathname } = new URL(url);
  return `https://${host}${pathname.replace(".git", "")}`;
}

function stripVersion(version: string): string {
  return version.replace(/[\^~]/, "");
}

function makePluginUrl(plugin: string, version?: string): string {
  if (plugin.startsWith("@oclif")) {
    return version
      ? `https://github.com/oclif/${plugin.replace(
          "@oclif/",
          ""
        )}/releases/tag/${stripVersion(version)}`
      : `https://github.com/oclif/${plugin.replace("@oclif/", "")}`;
  }

  if (plugin.startsWith("@salesforce")) {
    return version
      ? `https://github.com/salesforcecli/${plugin.replace(
          "@salesforce/",
          ""
        )}/releases/tag/${stripVersion(version)}`
      : `https://github.com/salesforcecli/${plugin.replace(
          "@salesforce/",
          ""
        )}`;
  }

  return plugin;
}

function sessionStorageId(version: string): string {
  return `npm_sf_cli_${version}`;
}

async function fetchNpmData(version: string): Promise<NpmData> {
  const cached = sessionStorage.getItem(sessionStorageId(version));
  if (cached) {
    return JSON.parse(cached) as NpmData;
  }
  const response = await fetch(
    `https://registry.npmjs.org/@salesforce/cli/${version}`
  );
  const data = (await response.json()) as NpmData;
  sessionStorage.setItem(sessionStorageId(version), JSON.stringify(data));
  return data;
}

function unique(array: string[]): string[] {
  return Array.from(new Set(array));
}

function humanReadableLocaleDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    month: "long",
    timeZoneName: "short",
    weekday: "short",
    year: "numeric",
  });
}

function humanReadableUTCDate(date: string): string {
  return new Date(date).toUTCString();
}

function sortPRsBy(
  array: PullRequest[],
  key: keyof PullRequest,
  direction?: "desc" | "asc"
): PullRequest[] {
  const dir = direction === "desc" ? 1 : -1;
  return array.sort((a, b) => {
    if (a[key] < b[key]) return dir;
    if (a[key] > b[key]) return dir;
    return 0;
  });
}

async function getMergedPullRequests({
  owner,
  repo,
  startDate,
  endDate,
}: {
  owner: string;
  repo: string;
  startDate: string;
  endDate: string;
}) {
  console.log(`[PR SEARCH] owner: ${owner}, repo: ${repo}, startDate: ${startDate}, endDate: ${endDate}`)
  try {
    const query = `
{
  search(query: "repo:${owner}/${repo} is:pr is:merged merged:>${startDate}", type: ISSUE, last: 100) {
    edges {
      node {
        ... on PullRequest {
          url
          title
          createdAt
          mergedAt
          author {login}
        }
      }
    }
  }
}
`;
    const result = await graphql<{
      search: {
        edges: Array<{
          node: {
            createdAt: string;
            title: string;
            url: string;
            mergedAt: string;
            author: { login: string };
          };
        }>;
      };
    }>(query, {
      headers: {
        authorization: `token ${process.env.REACT_APP_GH_TOKEN}`,
      },
    });
    console.log(result)
    return sortPRsBy(
      result.search.edges
        .map((e) => ({
          createdAt: e.node.createdAt,
          mergedAt: e.node.mergedAt,
          title: e.node.title,
          url: e.node.url,
          author: e.node.author.login,
        }))
        .filter((e) => e.mergedAt <= endDate),
      "mergedAt",
      "desc"
    );
  } catch (error) {
    throw error;
  }
}

function isPkgWeOwn(pkg: string): boolean {
  return pkg.startsWith("@salesforce") || pkg.startsWith("@oclif");
}

function figureOutOwnerAndRepo(
  pkg: string
): { owner: string; repo: string } | undefined {
  const forcedotcomRepos: Record<string, { owner: string; repo: string }> = {
    "@salesforce/core": { owner: "forcedotcom", repo: "sfdx-core" },
  };
  if (pkg.startsWith("@oclif")) {
    return { owner: "oclif", repo: pkg.split("/")[1] };
  }

  if (forcedotcomRepos[pkg]) {
    return forcedotcomRepos[pkg];
  }

  if (pkg.startsWith("@salesforce")) {
    return { owner: "salesforcecli", repo: pkg.split("/")[1] };
  }
}

function Comparison() {
  const [versions, setVersions] = React.useState<string[]>([]);
  const [baseVersion, setBaseVersion] = React.useState<string>();
  const [compareVersion, setCompareVersion] = React.useState<string>();
  const [npmData, setNpmData] = React.useState<NpmData>();

  React.useEffect(() => {
    fetch("https://registry.npmjs.org/@salesforce/cli")
      .then((response) => response.json())
      .then((data) => {
        setNpmData(data);
        const versions = semver.sort(Object.keys(data.versions)).reverse();
        setVersions(versions);
        setBaseVersion(data["dist-tags"].latest);
        setCompareVersion(data["dist-tags"]["latest-rc"]);
      });
  }, []);

  return (
    <Container fluid>
      <Row>
        <Col>
          <VersionDropdown
            versions={versions}
            defaultVersion={
              baseVersion ?? npmData?.["dist-tags"].latest ?? versions[0]
            }
            handleSelect={(eventKey) => {
              if (eventKey) setBaseVersion(eventKey);
            }}
          />
        </Col>
        <Col>
          <VersionDropdown
            versions={versions}
            defaultVersion={
              compareVersion ??
              npmData?.["dist-tags"]["latest-rc"] ??
              versions.at(1) ??
              versions[0]
            }
            handleSelect={(eventKey) => {
              if (eventKey) setCompareVersion(eventKey);
            }}
          />
        </Col>
      </Row>

      {npmData && baseVersion && compareVersion && (
        <Result latest={npmData} base={baseVersion} compare={compareVersion} />
      )}
    </Container>
  );
}

function Result({
  base,
  compare,
  latest,
}: {
  base: string;
  compare: string;
  latest: NpmData;
}) {
  const [baseData, setBaseData] = React.useState<NpmData>();
  const [compareData, setCompareData] = React.useState<NpmData>();
  const [loading, setLoading] = React.useState<boolean>(true);

  React.useEffect(() => {
    setLoading(true);
    const fetchData = async (base: string, compare: string) => {
      const [baseData, compareData] = await Promise.all([
        fetchNpmData(base),
        fetchNpmData(compare),
      ]);
      setBaseData({ ...baseData, time: latest.time });
      setCompareData({ ...compareData, time: latest.time });
      setLoading(false);
    };

    fetchData(base, compare);
  }, [base, compare, latest]);

  if (!compareData || !baseData || loading) {
    return (
      <Spinner animation="border" role="status" variant="primary">
        <span className="visually-hidden">Loading...</span>
      </Spinner>
    );
  }

  return (
    <Row>
      <Col>
        <NpmMeta data={baseData} />
      </Col>
      <Col>
        <NpmMeta data={compareData} />
      </Col>
      <Row>
        <Dependencies base={baseData} compare={compareData} />
      </Row>
      <Row>
        <ReleaseNotes base={baseData.version} compare={compareData.version} />
      </Row>
    </Row>
  );
}

function NpmMeta({ data }: { data: NpmData }) {
  return (
    <Table className="table">
      <tbody>
        <tr>
          <td>Name</td>
          <td>{data.name}</td>
        </tr>
        <tr>
          <td>Version</td>
          <td>
            <a href={makePluginUrl(data.name, data.version)}>
              {data.version}
            </a>
          </td>
        </tr>
        <tr>
          <td>Publish date (locale)</td>
          <td>{humanReadableLocaleDate(data.time[data.version])}</td>
        </tr>
        <tr>
          <td>Publish date (UTC)</td>
          <td>{humanReadableUTCDate(data.time[data.version])}</td>
        </tr>
        <tr>
          <td>Size (mb)</td>
          <td>{bytesToMB(data.dist.unpackedSize)}</td>
        </tr>
        <tr>
          <td>Commit</td>
          <td>
            <a
              href={`${normalizeGitUrl(data.repository.url)}/commit/${
                data.gitHead
              }`}
            >
              {data.gitHead.slice(0, 7)}
            </a>
          </td>
        </tr>
      </tbody>
    </Table>
  );
}

function Dependencies({ base, compare }: { base: NpmData; compare: NpmData }) {
  const plugins = Object.fromEntries(
    unique([...base.oclif.plugins, ...compare.oclif.plugins])
      .sort()
      .map((plugin) => [
        plugin,
        {
          base: base.dependencies[plugin],
          compare: compare.dependencies[plugin],
        },
      ])
  );

  const jitPlugins = Object.fromEntries(
    unique([
      ...Object.keys(base.oclif.jitPlugins),
      ...Object.keys(compare.oclif.jitPlugins),
    ])
      .sort()
      .map((plugin) => [
        plugin,
        {
          base: base.oclif.jitPlugins[plugin],
          compare: compare.oclif.jitPlugins[plugin],
        },
      ])
  );

  const nonPluginDeps = Object.fromEntries(
    unique([
      ...Object.keys(base.dependencies),
      ...Object.keys(compare.dependencies),
    ])
      .filter(
        (name) =>
          !base.oclif.plugins.includes(name) &&
          !compare.oclif.plugins.includes(name)
      )
      .sort()
      .map((dependency) => [
        dependency,
        {
          base: base.dependencies[dependency],
          compare: compare.dependencies[dependency],
        },
      ])
  );

  return (
    <>
      <DependencyTable
        base={base}
        compare={compare}
        plugins={plugins}
        title="Plugins"
      />

      <DependencyTable
        base={base}
        compare={compare}
        plugins={jitPlugins}
        title="JIT Plugins"
      />

      <DependencyTable
        base={base}
        compare={compare}
        plugins={nonPluginDeps}
        title="Non-Plugin Dependencies"
      />
    </>
  );
}

function DependencyTable({
  base: baseData,
  compare: compareData,
  plugins,
  title,
}: {
  base: NpmData;
  compare: NpmData;
  plugins: Record<string, { base: string; compare: string }>;
  title: string;
}) {
  if (Object.keys(plugins).length === 0) return null;
  return (
    <>
      <h3>{title}</h3>
      <Table className="table">
        <thead>
          <tr>
            <th>Dependency</th>
            <th>{baseData.version}</th>
            <th>{compareData.version}</th>
            <th>PRs</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(plugins).map(([dep, { base, compare }]) => (
            <tr key={dep}>
              <td>{dep}</td>
              <td>
                <a href={makePluginUrl(dep, base)}>{base}</a>
              </td>
              <td>
                <a href={makePluginUrl(dep, compare)}>{compare}</a>
              </td>
              <td>
                <PullRequestModal
                  pkg={dep}
                  base={baseData}
                  compare={compareData}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function ReleaseNotes({ base, compare }: { base: string; compare: string }) {
  const [releases, setReleases] = React.useState<Map<string, string>>(
    new Map()
  );
  const [oldReleases, setOldReleases] = React.useState<Map<string, string>>(
    new Map()
  );
  const url =
    "https://raw.githubusercontent.com/forcedotcom/cli/main/releasenotes/README.md";
  const oldUrl =
    "https://raw.githubusercontent.com/forcedotcom/cli/main/releasenotes/sf/README.md";

  function buildReleaseNotes(raw: string) {
    const versionRegex = /^(\d+\.\d+\.\d+)/;
    const [, ...releases] = raw.split("## ");

    return new Map(
      releases
        .map((release) => {
          const [version] = release.match(versionRegex) || [];
          return version ? [version, `## ${release}`] : null;
        })
        .filter((release): release is [string, string] => Boolean(release))
    );
  }
  React.useEffect(() => {
    fetch(url)
      .then((response) => response.text())
      .then((data) => {
        setReleases(buildReleaseNotes(data));
      });

    fetch(oldUrl)
      .then((response) => response.text())
      .then((data) => {
        setOldReleases(buildReleaseNotes(data));
      });
  }, []);

  return (
    <>
      <Accordion>
        <Accordion.Item eventKey="0">
          <Accordion.Header>
            <h3>{base} Release Notes</h3>
          </Accordion.Header>
          <Accordion.Body className="release-notes">
            <Markdown>
              {releases.get(base) ??
                oldReleases.get(base) ??
                "No release notes"}
            </Markdown>
          </Accordion.Body>
        </Accordion.Item>
        <Accordion.Item eventKey="1">
          <Accordion.Header>
            <h3>{compare} Release Notes</h3>
          </Accordion.Header>
          <Accordion.Body className="release-notes">
            <Markdown>
              {releases.get(compare) ??
                oldReleases.get(compare) ??
                "No release notes"}
            </Markdown>
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </>
  );
}

function VersionDropdown({
  versions,
  defaultVersion,
  handleSelect,
}: {
  versions: string[];
  defaultVersion: string;
  handleSelect: (eventKey: string | null) => void;
}) {
  const [version, setVersion] = React.useState<string>(defaultVersion);
  return (
    <Dropdown
      onSelect={(event) => {
        if (event) {
          setVersion(event);
          handleSelect(event);
        }
      }}
    >
      <Dropdown.Toggle variant="secondary" id="dropdown-autoclose-true">
        {version ?? defaultVersion}
      </Dropdown.Toggle>

      <Dropdown.Menu>
        {versions.map((version) => (
          <Dropdown.Item key={version} eventKey={version}>
            {version}
          </Dropdown.Item>
        ))}
        <Dropdown.Item href="#/action-1">Action</Dropdown.Item>
        <Dropdown.Item href="#/action-2">Another action</Dropdown.Item>
        <Dropdown.Item href="#/action-3">Something else</Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
}

function PullRequestModal({
  base,
  compare,
  pkg,
}: {
  base: NpmData;
  compare: NpmData;
  pkg: string;
}) {
  const [show, setShow] = React.useState(false);
  const [prs, setPrs] = React.useState<PullRequest[]>([]);
  const [authorVisibility, setAuthorVisibility] = React.useState<
    Record<string, boolean>
  >({});
  const [authors, setAuthors] = React.useState<string[]>([]);

  const handleClose = () => setShow(false);
  const handleShow = () => setShow(true);

  React.useEffect(() => {
    if (show) {
      const { owner, repo } = figureOutOwnerAndRepo(pkg) ?? {owner: null, repo: null};
      if (!owner || !repo) return

      getMergedPullRequests({
        owner,
        repo,
        startDate: base.time[base.version],
        endDate: compare.time[compare.version],
      }).then((result) => {
        setPrs(result);
        const authors = unique(result.map((pr) => pr.author)).sort();
        setAuthors(authors);
        setAuthorVisibility(
          Object.fromEntries(authors.map((author) => [author, true]))
        );
      });
    }
  }, [show, base, compare, pkg]);

  return (
    <>
      <Button
        variant="secondary"
        onClick={handleShow}
        disabled={!isPkgWeOwn(pkg)}
      >
        See PRs
      </Button>

      <Modal show={show} fullscreen={true} onHide={handleClose}>
        <Modal.Header closeButton>
          <Modal.Title>Pull Requests</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>PRs for {pkg} merged between {humanReadableLocaleDate(base.time[base.version])} and {humanReadableLocaleDate(compare.time[compare.version])}</p>
          <Form>
            <Form.Group className="mb-3" controlId="author-select">
              <Form.Label>Filter PRs</Form.Label>
              {authors.map((author) => (
                <Form.Switch
                  label={author}
                  key={author}
                  defaultChecked={authorVisibility[author]}
                  onChange={() => {
                    setAuthorVisibility((prev) => ({
                      ...prev,
                      [author]: !prev[author],
                    }));
                  }}
                />
              ))}
            </Form.Group>
          </Form>

          <Table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Author</th>
                <th>Merged At</th>
              </tr>
            </thead>
            <tbody>
              {prs
                .filter((pr) => authorVisibility[pr.author])
                .map((pr) => (
                  <tr key={pr.url}>
                    <td>
                      <a href={pr.url}>{pr.title}</a>
                    </td>
                    <td>{pr.author}</td>
                    <td>{humanReadableLocaleDate(pr.mergedAt)}</td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

function App() {
  return (
    <div>
      <header className="header">
        <h2>@salesforce/cli Version Comparison</h2>
      </header>
      <Comparison />
    </div>
  );
}

export default App;
