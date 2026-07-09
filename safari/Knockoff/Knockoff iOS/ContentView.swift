//
//  ContentView.swift
//  Knockoff iOS
//
//  Static "turn me on" screen. iOS can't deep-link straight to the extension
//  toggle, so the button opens the app's Settings page (the accepted
//  convention) and the steps walk the rest of the way.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 24) {
            Image("LargeIcon")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 96, height: 96)
                .shadow(color: .black.opacity(0.12), radius: 8, y: 4)

            Text("Knockoff")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Knockoff is a Safari extension. Turn it on and it filters pseudo-brand junk out of Amazon search as you shop.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 10) {
                Label("Settings → Apps → Safari → Extensions → turn on Knockoff", systemImage: "1.circle")
                Label("Tap Knockoff, then set Amazon (or Every Website) to Allow", systemImage: "2.circle")
                Label("Open Amazon in Safari — it just runs, no prompt to wait for", systemImage: "3.circle")
            }
            .font(.callout)

            Text("Safari never pops up to ask — that's its privacy design, not a bug. Grant access once (“Always Allow on Every Website” is easiest) and it sticks.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            } label: {
                Text("Open Settings").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(28)
    }
}

#Preview {
    ContentView()
}
