#!/usr/bin/env ruby
# frozen_string_literal: true
#
# Submit an uploaded Knockoff macOS build to App Store review.
# Usage: ./scripts/submit-appstore.rb [<build_number>] [--preflight] [--release-type=MANUAL|AFTER_APPROVAL]
#
# Run AFTER release-safari.sh has uploaded the build.
# --preflight checks ASC metadata without submitting (run before archiving).
# If <build_number> is omitted, reads safari/Knockoff/build/.last-build-number.
#
# Credentials (App Store Connect API key) come from .env.asc in the repo root:
#   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_FILE (path to the .p8)
# Optional: ASC_REVIEW_NOTES, ASC_REVIEW_CONTACT_{FIRST_NAME,LAST_NAME,PHONE,EMAIL}

require 'openssl'
require 'base64'
require 'json'
require 'net/http'
require 'uri'

ROOT = File.expand_path('..', __dir__)
BUNDLE_ID = 'shopping.knockoff.Knockoff'
API = 'https://api.appstoreconnect.apple.com'
BUILD_POLL_TIMEOUT = 30 * 60
VALID_RELEASE_TYPES = %w[MANUAL AFTER_APPROVAL].freeze
PLATFORM = 'MAC_OS'

# Load .env.asc if the vars aren't already in the environment.
env_file = File.join(ROOT, '.env.asc')
if ENV['ASC_KEY_ID'].to_s.empty? && File.exist?(env_file)
  File.readlines(env_file).each do |line|
    next unless line =~ /\A([A-Z_]+)=(.*)\z/m
    ENV[Regexp.last_match(1)] = Regexp.last_match(2).strip.delete_prefix('"').delete_suffix('"')
  end
end

preflight_only = false
release_type = 'MANUAL'
positional = []
ARGV.each do |arg|
  case arg
  when '--preflight' then preflight_only = true
  when /\A--release-type=(.+)\z/
    release_type = Regexp.last_match(1)
    abort "Invalid --release-type. Must be one of: #{VALID_RELEASE_TYPES.join(', ')}" unless VALID_RELEASE_TYPES.include?(release_type)
  else positional << arg
  end
end

VERSION = JSON.parse(File.read(File.join(ROOT, 'manifest.json')))['version']

BUILD_NUMBER = positional[0] || begin
  path = File.join(ROOT, 'safari/Knockoff/build/.last-build-number')
  if preflight_only && !File.exist?(path)
    nil
  else
    abort "No build number given and #{path} not found. Run release-safari.sh first." unless File.exist?(path)
    File.read(path).strip
  end
end

KEY_ID = ENV['ASC_KEY_ID'] or abort 'Set ASC_KEY_ID (see .env.asc)'
ISSUER_ID = ENV['ASC_ISSUER_ID'] or abort 'Set ASC_ISSUER_ID'
KEY_PATH = File.expand_path(ENV['ASC_KEY_FILE'] || "~/.appstoreconnect/AuthKey_#{KEY_ID}.p8")
abort "ASC key file not found: #{KEY_PATH}" unless File.exist?(KEY_PATH)

def b64url(data) = Base64.urlsafe_encode64(data, padding: false)

def generate_jwt
  header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' }.to_json
  payload = { iss: ISSUER_ID, exp: Time.now.to_i + 1200, aud: 'appstoreconnect-v1' }.to_json
  data = "#{b64url(header)}.#{b64url(payload)}"
  key = OpenSSL::PKey::EC.new(File.read(KEY_PATH))
  der = key.sign(OpenSSL::Digest.new('SHA256'), data)
  asn1 = OpenSSL::ASN1.decode(der)
  r_hex = asn1.value[0].value.to_s(16).rjust(64, '0')
  s_hex = asn1.value[1].value.to_s(16).rjust(64, '0')
  "#{data}.#{b64url([r_hex + s_hex].pack('H*'))}"
end

@token = generate_jwt
@token_minted_at = Time.now

def token
  if Time.now - @token_minted_at > 1000
    @token = generate_jwt
    @token_minted_at = Time.now
  end
  @token
end

def req(method, path, body = nil, raise_on_error: true)
  url = URI(path.start_with?('http') ? path : "#{API}#{path}")
  klass = { get: Net::HTTP::Get, post: Net::HTTP::Post, patch: Net::HTTP::Patch, delete: Net::HTTP::Delete }[method]
  r = klass.new(url)
  r['Authorization'] = "Bearer #{token}"
  r['Content-Type'] = 'application/json'
  r.body = body.to_json if body
  res = Net::HTTP.start(url.host, url.port, use_ssl: true) { |h| h.request(r) }
  data = res.body.to_s.empty? ? {} : JSON.parse(res.body)
  unless res.is_a?(Net::HTTPSuccess)
    if raise_on_error
      warn "API error (#{res.code}) on #{method.to_s.upcase} #{path}:"
      warn JSON.pretty_generate(data)
      raise 'ASC API error'
    else
      return [data, res.code.to_i]
    end
  end
  raise_on_error ? data : [data, res.code.to_i]
end

puts "Looking up app by bundle ID #{BUNDLE_ID}..."
apps = req(:get, "/v1/apps?filter%5BbundleId%5D=#{URI.encode_www_form_component(BUNDLE_ID)}")
app = apps['data']&.first
abort "No App Store Connect app record found for #{BUNDLE_ID}. Create it in ASC first." unless app
APP_ID = app['id']
puts "   App: #{app['attributes']['name']} (#{APP_ID})"

def find_version
  versions = req(:get, "/v1/apps/#{APP_ID}/appStoreVersions?filter%5BversionString%5D=#{URI.encode_www_form_component(VERSION)}&filter%5Bplatform%5D=#{PLATFORM}&limit=1")
  versions['data']&.first
end

if preflight_only
  issues = []
  app_infos = req(:get, "/v1/apps/#{APP_ID}/appInfos")
  info = app_infos['data'].find { |i| %w[PREPARE_FOR_SUBMISSION READY_FOR_SALE].include?(i.dig('attributes', 'appStoreState')) } || app_infos['data'].first
  if info
    locs = req(:get, "/v1/appInfos/#{info['id']}/appInfoLocalizations")
    en = locs['data'].find { |l| l['attributes']['locale'] == 'en-US' } || locs['data'].first
    issues << 'App Info: name missing (en-US)' if en.nil? || en.dig('attributes', 'name').to_s.strip.empty?
    issues << 'App Info: privacyPolicyUrl missing (en-US)' if en.nil? || en.dig('attributes', 'privacyPolicyUrl').to_s.strip.empty?
  else
    issues << 'App Info: no AppInfo records found'
  end
  if (version = find_version)
    puts "   Found existing #{PLATFORM} version #{VERSION} (state=#{version.dig('attributes', 'appStoreState')})"
    locs = req(:get, "/v1/appStoreVersions/#{version['id']}/appStoreVersionLocalizations")
    en = locs['data'].find { |l| l['attributes']['locale'] == 'en-US' } || locs['data'].first
    if en
      issues << 'Version: description missing' if en.dig('attributes', 'description').to_s.strip.length < 10
      issues << 'Version: keywords missing' if en.dig('attributes', 'keywords').to_s.strip.empty?
      issues << 'Version: supportUrl missing' if en.dig('attributes', 'supportUrl').to_s.strip.empty?
    end
  else
    puts "   No #{PLATFORM} App Store version for #{VERSION} yet - will be created at submit time."
  end
  puts ''
  if issues.empty?
    puts 'Preflight: no blocking issues found.'
    puts 'Note: screenshots, age rating, pricing, and App Privacy are not fully checkable here - verify in ASC.'
  else
    puts 'Preflight found blocking issues:'
    issues.each { |i| puts "   - #{i}" }
  end
  exit(issues.empty? ? 0 : 1)
end

puts "Waiting for #{PLATFORM} build #{BUILD_NUMBER} to finish processing (up to 30 min)..."
deadline = Time.now + BUILD_POLL_TIMEOUT
build = nil
loop do
  res = req(:get, "/v1/builds?filter%5Bapp%5D=#{APP_ID}&filter%5Bversion%5D=#{URI.encode_www_form_component(BUILD_NUMBER)}&filter%5BpreReleaseVersion.platform%5D=#{PLATFORM}&limit=1")
  build = res['data']&.first
  state = build&.dig('attributes', 'processingState')
  case state
  when 'VALID'
    puts '   Build processed.'
    break
  when 'FAILED', 'INVALID'
    abort "Build processing failed (state=#{state})."
  else
    puts "   Still waiting (#{build ? "state=#{state}" : 'not yet visible'})..."
  end
  abort "Timed out waiting for build #{BUILD_NUMBER}." if Time.now > deadline
  sleep 30
end

puts "Finding or creating #{PLATFORM} App Store Version #{VERSION} (releaseType=#{release_type})..."
version = find_version
editable_states = %w[PREPARE_FOR_SUBMISSION DEVELOPER_REJECTED REJECTED METADATA_REJECTED INVALID_BINARY]
if version
  state = version.dig('attributes', 'appStoreState')
  abort "Version #{VERSION} is in state #{state} and can't be edited." unless editable_states.include?(state)
  if version.dig('attributes', 'releaseType') != release_type
    req(:patch, "/v1/appStoreVersions/#{version['id']}",
        { data: { type: 'appStoreVersions', id: version['id'], attributes: { releaseType: release_type } } })
    puts "   Updated releaseType -> #{release_type}"
  end
else
  res, code = req(:post, '/v1/appStoreVersions', {
    data: {
      type: 'appStoreVersions',
      attributes: { platform: PLATFORM, versionString: VERSION, releaseType: release_type },
      relationships: { app: { data: { type: 'apps', id: APP_ID } } }
    }
  }, raise_on_error: false)
  if code.between?(200, 299)
    version = res['data']
    puts "   Created version #{version['id']}"
  else
    # ASC auto-creates an editable version per platform; reuse it.
    existing = req(:get, "/v1/apps/#{APP_ID}/appStoreVersions?filter%5Bplatform%5D=#{PLATFORM}&limit=10")
    version = existing['data'].find { |v| editable_states.include?(v.dig('attributes', 'appStoreState')) }
    abort "Could not create version (HTTP #{code}) and no editable #{PLATFORM} version found." unless version
    req(:patch, "/v1/appStoreVersions/#{version['id']}", {
      data: { type: 'appStoreVersions', id: version['id'],
              attributes: { versionString: VERSION, releaseType: release_type } }
    })
    puts "   Reusing version #{version['id']} -> #{VERSION}"
  end
end
version_id = version['id']

# App Review notes + contact (optional; no demo account - Knockoff has no sign-in)
review_attrs = {}
{
  contactFirstName: 'ASC_REVIEW_CONTACT_FIRST_NAME',
  contactLastName: 'ASC_REVIEW_CONTACT_LAST_NAME',
  contactPhone: 'ASC_REVIEW_CONTACT_PHONE',
  contactEmail: 'ASC_REVIEW_CONTACT_EMAIL',
  notes: 'ASC_REVIEW_NOTES'
}.each do |attr, env_key|
  val = ENV[env_key].to_s.strip
  review_attrs[attr] = val unless val.empty?
end
unless review_attrs.empty?
  puts 'Setting App Review notes/contact...'
  detail_res, code = req(:get, "/v1/appStoreVersions/#{version_id}/appStoreReviewDetail", nil, raise_on_error: false)
  detail = detail_res.is_a?(Hash) ? detail_res['data'] : nil
  if detail
    req(:patch, "/v1/appStoreReviewDetails/#{detail['id']}",
        { data: { type: 'appStoreReviewDetails', id: detail['id'], attributes: review_attrs } })
  else
    req(:post, '/v1/appStoreReviewDetails', {
      data: {
        type: 'appStoreReviewDetails',
        attributes: review_attrs,
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version_id } } }
      }
    })
  end
end

puts 'Attaching build to version...'
req(:patch, "/v1/appStoreVersions/#{version_id}/relationships/build",
    { data: { type: 'builds', id: build['id'] } })

puts 'Submitting for App Review...'
asc_url = "https://appstoreconnect.apple.com/apps/#{APP_ID}/appstore/#{version_id}"
begin
  # Reuse an open (unsubmitted) review submission if one exists from a prior attempt.
  open_subs = req(:get, "/v1/reviewSubmissions?filter%5Bapp%5D=#{APP_ID}&filter%5Bplatform%5D=#{PLATFORM}&filter%5Bstate%5D=READY_FOR_REVIEW&limit=1")
  submission_id = open_subs['data']&.first&.fetch('id', nil)
  if submission_id
    puts "   Reusing open review submission #{submission_id}"
  else
    submission = req(:post, '/v1/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: PLATFORM },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } }
      }
    })
    submission_id = submission['data']['id']
  end
  items = req(:get, "/v1/reviewSubmissions/#{submission_id}/items")
  if items['data'].to_a.empty?
    req(:post, '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: submission_id } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: version_id } }
        }
      }
    })
  end
  req(:patch, "/v1/reviewSubmissions/#{submission_id}",
      { data: { type: 'reviewSubmissions', id: submission_id, attributes: { submitted: true } } })
rescue RuntimeError
  warn ''
  warn 'Submission failed - metadata may be incomplete. The version, build, and review'
  warn "details are already saved; finish the remaining fields at:"
  warn "  #{asc_url}"
  exit 1
end

puts ''
puts "Knockoff v#{VERSION} (build #{BUILD_NUMBER}, #{PLATFORM}) submitted for App Review."
puts "   Release: #{release_type == 'MANUAL' ? 'manual (click Release this version after approval)' : 'auto on approval'}"
puts "   #{asc_url}"
